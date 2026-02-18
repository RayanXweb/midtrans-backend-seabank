require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const midtransClient = require("midtrans-client");
const admin = require("firebase-admin");
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// =======================
// FIREBASE INIT
// =======================
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FB_PROJECT_ID,
    clientEmail: process.env.FB_CLIENT_EMAIL,
    privateKey: process.env.FB_PRIVATE_KEY.replace(/\\n/g, '\n')
  })
});

const db = admin.firestore();

// =======================
// MIDTRANS INIT
// =======================
let snap = new midtransClient.Snap({
  isProduction: false,
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY
});

// =======================
// ROOT
// =======================
app.get("/", (req, res) => {
  res.send("Backend TopUp & Withdraw SeaBank Running 🚀");
});

// =======================
// CREATE PAYMENT
// =======================
app.post("/create-payment", async (req, res) => {
  try {
    const { uid, amount } = req.body;

    const order_id = "TOPUP-" + Date.now();

    let parameter = {
      transaction_details: {
        order_id,
        gross_amount: amount
      }
    };

    const transaction = await snap.createTransaction(parameter);

    await db.collection("transactions").doc(order_id).set({
      uid,
      type: "topup",
      amount,
      status: "pending",
      created_at: new Date()
    });

    res.json({ token: transaction.token });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =======================
// WEBHOOK MIDTRANS
// =======================
app.post("/webhook", async (req, res) => {
  try {
    const notif = req.body;

    // VERIFY SIGNATURE
    const hash = crypto.createHash("sha512")
      .update(notif.order_id + notif.status_code + notif.gross_amount + process.env.MIDTRANS_SERVER_KEY)
      .digest("hex");

    if (hash !== notif.signature_key) {
      return res.status(403).send("Invalid signature");
    }

    if (notif.transaction_status === "settlement") {
      const orderRef = db.collection("transactions").doc(notif.order_id);
      const doc = await orderRef.get();

      if (doc.exists) {
        const uid = doc.data().uid;
        const amount = doc.data().amount;

        // Update saldo user
        const userRef = db.collection("users").doc(uid);
        await db.runTransaction(async (t) => {
          const userDoc = await t.get(userRef);
          const currentBalance = userDoc.data().balance || 0;
          t.update(userRef, { balance: currentBalance + amount });
        });

        await orderRef.update({ status: "success" });
      }
    }

    res.status(200).send("OK");

  } catch (err) {
    res.status(500).send("Error");
  }
});

// =======================
// WITHDRAW REQUEST
// =======================
app.post("/withdraw", async (req, res) => {
  try {
    const { uid, amount, account_number } = req.body;

    const userRef = db.collection("users").doc(uid);
    const userDoc = await userRef.get();

    const currentBalance = userDoc.data().balance || 0;

    if (currentBalance < amount) {
      return res.status(400).json({ message: "Saldo tidak cukup" });
    }

    // Kurangi saldo
    await userRef.update({
      balance: currentBalance - amount
    });

    await db.collection("withdraw_requests").add({
      uid,
      amount,
      account_number,
      status: "pending",
      created_at: new Date()
    });

    res.json({ message: "Withdraw berhasil diajukan" });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =======================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
