const GETNET_CLIENT_ID = process.env.GETNET_CLIENT_ID;
const GETNET_CLIENT_SECRET = process.env.GETNET_CLIENT_SECRET;
const GETNET_SELLER_ID = process.env.GETNET_SELLER_ID;

const GETNET_URL = "https://api.getnet.com.br";

/* TOKEN */

async function getToken() {
  const credentials = Buffer.from(
    `${GETNET_CLIENT_ID}:${GETNET_CLIENT_SECRET}`
  ).toString("base64");

  const res = await fetch(
    `${GETNET_URL}/auth/oauth/v2/token`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type":
          "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials&scope=oob",
    }
  );

  const data = await res.json();

  if (!res.ok) {
    throw new Error(JSON.stringify(data));
  }

  return data.access_token;
}

/* TOKENIZA CARTÃO */

async function tokenizeCard(
  token,
  cardNumber,
  customerId
) {
  const response = await fetch(
    `${GETNET_URL}/v1/tokens/card`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        seller_id: GETNET_SELLER_ID,
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        card_number: cardNumber.replace(/\s/g, ""),
        customer_id: customerId,
      }),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(JSON.stringify(data));
  }

  return data.number_token;
}

export default async function handler(req, res) {
  try {
    const {
      amount,
      installments,
      cardNumber,
      cardExpiry,
      cardCvv,
      cardHolder,
      customerName,
      customerCpf,
      customerEmail,
      customerPhone,
    } = req.body;

    const token = await getToken();

    const customerId =
      "customer-" +
      customerCpf.replace(/\D/g, "");

    const numberToken = await tokenizeCard(
      token,
      cardNumber,
      customerId
    );

    const [month, yearRaw] =
      cardExpiry.split("/");

    const year = yearRaw.slice(-2);

    const response = await fetch(
      `${GETNET_URL}/v1/payments/credit`,
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${token}`,
          seller_id: GETNET_SELLER_ID,
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          seller_id: GETNET_SELLER_ID,

          amount: Number(amount),

          currency: "BRL",

          order: {
            order_id: `GAMA-${Date.now()}`,
            sales_tax: 0,
            product_type: "service",
          },

          customer: {
            customer_id: customerId,

            first_name:
              customerName.split(" ")[0],

            last_name:
              customerName
                .split(" ")
                .slice(1)
                .join(" ") || ".",

            email: customerEmail,

            document_type: "CPF",

            document_number:
              customerCpf.replace(/\D/g, ""),

            phone_number:
              customerPhone.replace(/\D/g, ""),
          },

          device: {
            device_id:
              "device-" + Date.now(),

            ip_address:
              req.headers["x-forwarded-for"] ||
              "127.0.0.1",
          },

          credit: {
            delayed: false,
            authenticated: false,
            pre_authorization: false,
            save_card_data: false,

            transaction_type: "FULL",

            number_installments:
              Number(installments) || 1,

            soft_descriptor: "GAMA MOVEIS",

            card: {
              number_token: numberToken,

              cardholder_name: cardHolder,

              security_code: cardCvv,

              brand: detectBrand(cardNumber),

              expiration_month: month,

              expiration_year: year,
            },
          },
        }),
      }
    );

    const data = await response.json();

    return res.status(200).json(data);
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      error: err.message,
    });
  }
}

function detectBrand(num) {
  const n = num.replace(/\s/g, "");

  if (/^4/.test(n)) return "Visa";

  if (/^5[1-5]/.test(n))
    return "Mastercard";

  if (/^3[47]/.test(n)) return "Amex";

  if (
    /^(6362|438935|504175|451416|636297|5067|4576|4011)/.test(
      n
    )
  ) {
    return "Elo";
  }

  return "Mastercard";
}
