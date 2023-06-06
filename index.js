const express = require("express");
const cors = require("cors");
const app = express();
const jwt = require("jsonwebtoken");
require("dotenv").config();
const stripe = require("stripe")(process.env.PAYMENT_SECRET_KEY);
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
app.use(cors());
app.use(express.json());

//console.log(process.env.PAYMENT_SECRET_KEY);

const verifyJWT = (req, res, next) => {
  const authorization = req.headers.authorization;
  //console.log("token", authorization);
  if (!authorization) {
    return res.status(401).send({ error: true, message: "UnAuthorized User" });
  }

  const token = authorization.split(" ")[1];
  if (!token) {
    return res.status(401).send({ error: true, message: "UnAuthorized User" });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SCRET, (err, decoded) => {
    if (err) {
      return res
        .status(401)
        .send({ error: true, message: "unauthorized access" });
    }
    req.decoded = decoded;
    next();
  });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.5onzxss.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const menuCollection = client.db("bristroBossDB").collection("menus");
    const cartsCollection = client.db("bristroBossDB").collection("carts");
    const usersCollection = client.db("bristroBossDB").collection("users");
    const paymentsCollection = client
      .db("bristroBossDB")
      .collection("payments");

    app.post("/jwt", (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SCRET, {
        expiresIn: "1h",
      });

      res.send({ token });
    });

    //admin middleware
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      //console.log("verify", email);
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      //console.log("user", user);
      if (user?.role !== "admin") {
        return res
          .status(403)
          .send({ error: true, message: "forbidden message" });
      }
      next();
    };

    // users

    app.get("/users", verifyJWT, verifyAdmin, async (req, res) => {
      const result = await usersCollection.find({}).toArray();
      res.send(result);
    });
    //admin user
    app.get("/users/admin/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;
      // console.log(req.decoded.email);
      if (req.decoded.email !== email) {
        return res.send({ admin: false });
      }
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const result = { admin: user?.role === "admin" };
      res.send(result);
    });
    //users api start
    app.post("/users", async (req, res) => {
      const userInfo = req.body;
      const query = { email: userInfo.email };
      const existingEmail = await usersCollection.findOne(query);
      if (existingEmail) {
        return res.send({ message: "user already exists" });
      }
      const result = await usersCollection.insertOne(userInfo);
      res.send(result);
    });

    app.patch("/users/admin/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const upDoc = {
        $set: {
          role: "admin",
        },
      };
      const result = await usersCollection.updateOne(filter, upDoc);
      res.send(result);
    });

    app.delete("/users/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await usersCollection.deleteOne(query);
      res.send(result);
    });

    //menu item api
    app.get("/menus", async (req, res) => {
      const result = await menuCollection.find().toArray();
      res.send(result);
    });

    app.post("/menus", verifyJWT, verifyAdmin, async (req, res) => {
      const menuItems = req.body;
      const result = await menuCollection.insertOne(menuItems);
      res.send(result);
    });

    app.delete("/menus/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      console.log(query);
      const result = await menuCollection.deleteOne(query);
      res.send(result);
    });

    app.post("/carts", async (req, res) => {
      const items = req.body;
      //console.log(items);
      const result = await cartsCollection.insertOne(items);
      res.send(result);
    });
    app.delete("/carts/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cartsCollection.deleteOne(query);
      res.send(result);
    });

    app.get("/carts", verifyJWT, async (req, res) => {
      const email = req.query.email;
      //console.log(req.decoded);
      if (req.decoded.email !== email) {
        return res
          .status(403)
          .send({ error: true, message: "forbiden access" });
      }
      const query = { email: email };
      const result = await cartsCollection.find(query).toArray();
      res.send(result);
      //console.log(email);
    });

    //payment gets implements api

    app.post("/create-payment-intent", verifyJWT, async (req, res) => {
      const { price } = req.body;
      const amount = price * 100;

      // Create a PaymentIntent with the order amount and currency
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        automatic_payment_methods: {
          enabled: true,
        },
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    app.post("/payment", verifyJWT, async (req, res) => {
      const payment = req.body;
      const insertResult = await paymentsCollection.insertOne(payment);
      const query = {
        _id: { $in: payment.cartId.map((id) => new ObjectId(id)) },
      };
      const deleteCart = await cartsCollection.deleteMany(query);
      res.send({ insertResult, deleteCart });
    });

    app.get("/admin-stats", verifyJWT, verifyAdmin, async (req, res) => {
      const orders = await paymentsCollection.estimatedDocumentCount();
      const allUsers = await usersCollection.estimatedDocumentCount();
      const adminUser = await usersCollection.countDocuments({
        role: "admin",
      });
      const users = allUsers - adminUser;

      const product = await menuCollection.estimatedDocumentCount();
      const payment = await paymentsCollection.find().toArray();
      const revenue = payment.reduce((sum, item) => item.price + sum, 0);

      res.send({ orders, users, product, revenue, adminUser });
    });

    app.get("/order-stats", verifyJWT, verifyAdmin, async (req, res) => {
      const pipeline = [
        {
          $lookup: {
            from: "menus",
            localField: "menuId",
            foreignField: "_id",
            as: "menuItemsData",
          },
        },
        {
          $unwind: "$menuItemsData",
        },
        {
          $group: {
            _id: "$menuItemsData.category",
            count: { $sum: 1 },
            total: { $sum: "$menuItemsData.price" },
          },
        },
        {
          $project: {
            category: "$_id",
            count: 1,
            total: { $round: ["$total", 2] },
            _id: 0,
          },
        },
      ];

      const result = await paymentsCollection.aggregate(pipeline).toArray();
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Boss restuarent is eating");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
