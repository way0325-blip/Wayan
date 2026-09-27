// 輕量級輸入驗證中介層,不依賴額外套件。
// 用法: validateBody({ name: { required: true, type: "string", maxLength: 50 } })
function validateBody(schema) {
  return (req, res, next) => {
    const errors = [];
    const body = req.body || {};

    for (const [field, rules] of Object.entries(schema)) {
      const value = body[field];
      const present = value !== undefined && value !== null && value !== "";

      if (rules.required && !present) {
        errors.push(`${rules.label || field} 為必填`);
        continue;
      }

      if (!present) continue;

      if (rules.type === "string" && typeof value !== "string") {
        errors.push(`${rules.label || field} 格式錯誤`);
        continue;
      }

      if (rules.type === "string" && rules.maxLength && value.length > rules.maxLength) {
        errors.push(`${rules.label || field} 長度不可超過 ${rules.maxLength} 字`);
      }

      if (rules.type === "date" && Number.isNaN(new Date(value).getTime())) {
        errors.push(`${rules.label || field} 日期格式錯誤`);
      }

      if (rules.enum && !rules.enum.includes(value)) {
        errors.push(`${rules.label || field} 必須是:${rules.enum.join("、")}`);
      }

      if (rules.pattern && !rules.pattern.test(value)) {
        errors.push(`${rules.label || field} 格式不正確`);
      }
    }

    if (errors.length) {
      return res.status(400).json({ error: "輸入驗證失敗", details: errors });
    }

    next();
  };
}

module.exports = { validateBody };
