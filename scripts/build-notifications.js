const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const dataFile = path.join(rootDir, 'data', 'notifications.json');
const outputFile = path.join(rootDir, 'assets', 'js', 'notificationsData.js');

try {
  let rawdata = fs.readFileSync(dataFile, 'utf8');
  let notifications = JSON.parse(rawdata);
  
  const jsContent = `window.aeNotificationsData = ${JSON.stringify(notifications, null, 2)};`;
  fs.writeFileSync(outputFile, jsContent, 'utf8');
  console.log(`Successfully built notificationsData.js with ${notifications.length} notifications.`);
} catch (err) {
  console.error('Error building notifications:', err);
}
