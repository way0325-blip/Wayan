const express = require("express");
const { requireAuth, requireRole } = require("../auth");
const { getSettings, saveSetting } = require("../settings");
const { logAction } = require("../audit");

const router = express.Router();

// 公開:登入頁需要顯示系統名稱,只回傳不敏感的欄位
router.get("/public", async (req, res, next) => {
  try {
    const s = await getSettings();
    res.json({ systemName: s.system_name });
  } catch (err) {
    next(err);
  }
});

router.use(requireAuth);

function serialize(s) {
  return {
    systemName: s.system_name,
    announcement: s.announcement,
    locations: s.locations,
    containerSizes: s.container_sizes,
  };
}

router.get("/", async (req, res, next) => {
  try {
    res.json(serialize(await getSettings()));
  } catch (err) {
    next(err);
  }
});

function cleanList(value, label, maxItems, maxLen) {
  if (!Array.isArray(value)) return { error: `${label} 必須是清單` };
  const items = [...new Set(value.map((v) => String(v).trim()).filter(Boolean))];
  if (items.length > maxItems) return { error: `${label} 最多 ${maxItems} 項` };
  if (items.some((v) => v.length > maxLen)) return { error: `${label} 每項不可超過 ${maxLen} 字` };
  return { items };
}

router.put("/", requireRole("admin"), async (req, res, next) => {
  try {
    const { systemName, announcement, locations, containerSizes } = req.body || {};
    const changed = [];

    if (systemName !== undefined) {
      const v = String(systemName).trim();
      if (!v || v.length > 50) return res.status(400).json({ error: "系統名稱必填,且不可超過 50 字" });
      await saveSetting("system_name", v);
      changed.push("系統名稱");
    }
    if (announcement !== undefined) {
      const v = String(announcement).trim();
      if (v.length > 500) return res.status(400).json({ error: "公告不可超過 500 字" });
      await saveSetting("announcement", v);
      changed.push("公告");
    }
    if (locations !== undefined) {
      const r = cleanList(locations, "常用地點", 50, 50);
      if (r.error) return res.status(400).json({ error: r.error });
      await saveSetting("locations", r.items);
      changed.push("常用地點");
    }
    if (containerSizes !== undefined) {
      const r = cleanList(containerSizes, "貨櫃尺寸", 10, 20);
      if (r.error) return res.status(400).json({ error: r.error });
      if (!r.items.length) return res.status(400).json({ error: "貨櫃尺寸至少要有一項" });
      await saveSetting("container_sizes", r.items);
      changed.push("貨櫃尺寸");
    }

    if (!changed.length) return res.status(400).json({ error: "沒有要修改的欄位" });

    await logAction(req, "修改", "網站設定", null, changed.join("、"));
    res.json(serialize(await getSettings()));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
