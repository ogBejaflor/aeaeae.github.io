window.addEventListener('load', function () {
    updateClock();
    setInterval(updateClock, 1000); // Update clock every second

    if (navigator.getBattery) {
        navigator.getBattery().then(function (battery) {
            updateBatteryStatus(battery);
            battery.addEventListener('levelchange', () => updateBatteryStatus(battery));
            battery.addEventListener('chargingchange', () => updateBatteryStatus(battery));
        });
    } else {
        simulateBattery();
    }
});

function updateClock() {
    const now = new Date();
    const options = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' };
    const formattedDate = now.toLocaleString('en-US', options).replace(',', '');
    const formattedTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    document.getElementById('date-time').innerText = `${formattedDate} ${formattedTime}`;
}

function updateBatteryStatus(battery) {
    const batteryLevel = Math.floor(battery.level * 100);
    const batteryCharging = battery.charging ? '⚡' : '🔋';
    document.getElementById('battery-icon').innerText = `${batteryCharging} ${batteryLevel}%`;
}

function simulateBattery() {
    let batteryLevel = 80;
    const chargingIcon = '🔋';
    document.getElementById('battery-icon').innerText = `${chargingIcon} ${batteryLevel}%`;
    setInterval(() => {
        batteryLevel = Math.max(0, batteryLevel - 1);
        document.getElementById('battery-icon').innerText = `${chargingIcon} ${batteryLevel}%`;
    }, 60000);
}
