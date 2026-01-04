let duration = 0;
let isLearning = false;
let startTime = 0;
let callTimer = null;
let valveIp = null;

// Helper function to set valve state (opposite of light)
function setValve(on) {
    if (valveIp) {
        Shelly.call("HTTP.GET", {
            url: "http://" + valveIp + "/rpc/Switch.Set?id=0&on=" + on
        }, function (result, error_code, error_message) {
            if (error_code !== 0) {
                print("Valve error: " + error_message);
            } else {
                print("Valve set to " + on);
            }
        });
    }
}

Shelly.addEventHandler(function (e) {
    // Button 1: Learn button
    if (e.info.id === 1 && e.info.event === 'btn_down') {
        if (!isLearning) {
            // First press: start learning, turn light OFF, valve ON
            isLearning = true;
            startTime = Date.now();
            Shelly.call("Switch.Set", { id: 1, on: false });
            setValve(true);
            print("Learning started - light OFF, valve ON");
        } else {
            // Second press: stop learning, turn light ON, valve OFF, calculate duration
            isLearning = false;
            duration = Date.now() - startTime;
            Shelly.call("Switch.Set", { id: 1, on: true });
            setValve(false);
            // Save duration to persistent storage
            Shelly.call("KVS.Set", { key: "duration", value: duration });
            print("Learning stopped - duration: " + duration + "ms (saved)");
        }
    }

    // Button 0: Call button - turn on for learned duration
    if (e.info.id === 0 && e.info.event === 'btn_down') {
        if (duration > 0 && !isLearning) {
            // Cancel any existing timer
            if (callTimer !== null) {
                Timer.clear(callTimer);
            }
            // Turn light OFF, valve ON
            Shelly.call("Switch.Set", { id: 1, on: false });
            setValve(true);
            print("Call activated - light OFF, valve ON for " + duration + "ms");

            // Set timer to turn light ON, valve OFF after learned duration
            callTimer = Timer.set(duration, false, function () {
                Shelly.call("Switch.Set", { id: 1, on: true });
                setValve(false);
                callTimer = null;
                print("Call ended - light ON, valve OFF");
            });
        } else {
            print("No duration learned yet or still learning");
        }
    }
});

// Load saved duration from KVS on startup
Shelly.call("KVS.Get", { key: "duration" }, function (result, error_code, error_message) {
    if (error_code === 0 && result && result.value) {
        duration = result.value;
        print("Loaded saved duration: " + duration + "ms");
    } else {
        print("No saved duration found");
    }
});

// Load valve IP from KVS on startup
Shelly.call("KVS.Get", { key: "valveIp" }, function (result, error_code, error_message) {
    if (error_code === 0 && result && result.value) {
        valveIp = result.value;
        print("Loaded valve IP: " + valveIp);
    } else {
        print("No valve IP configured");
    }
});

// Initial state: light ON, valve OFF (not learning)
Shelly.call("Switch.Set", { id: 1, on: true });
setValve(false);