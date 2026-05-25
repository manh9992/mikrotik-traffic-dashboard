const fs = require('fs');

function migrate(file) {
  if (!fs.existsSync(file)) return;
  const data = JSON.parse(fs.readFileSync(file));
  for (const key in data) {
    const old = data[key];
    if (old.fptDl !== undefined) {
      data[key] = {
        wan1: { dl: old.fptDl || 0, ul: old.fptUl || 0 },
        wan2: { dl: old.vttDl || 0, ul: old.vttUl || 0 }
      };
    }
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

migrate('history.json');
migrate('hourly.json');
console.log('Migration complete.');
