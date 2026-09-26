require("dotenv").config();

const path = require("node:path");
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const driverRoutes = require("./routes/drivers");
const vehicleRoutes = require("./routes/vehicles");
const orderRoutes = require("./routes/orders");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/drivers", driverRoutes);
app.use("/api/vehicles", vehicleRoutes);
app.use("/api/orders", orderRoutes);

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

// 提供前端靜態檔案
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "伺服器發生錯誤" });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`港區星際運輸調度中心伺服器已啟動: http://localhost:${PORT}`);
  });
}

module.exports = app;
