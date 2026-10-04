const express = require("express");
const { requireAuth } = require("../auth");
const { computeAlerts } = require("../alerts");

const router = express.Router();

router.use(requireAuth);

router.get("/", async (req, res, next) => {
  try {
    res.json(await computeAlerts());
  } catch (err) {
    next(err);
  }
});

module.exports = router;
