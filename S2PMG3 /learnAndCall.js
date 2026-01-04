let duration = 0;
let isLearning = false;
let startTime = 0;
let callTimer = null;
let valveIp = null;

// HTTP request lock
let httpBusy = false;
let pendingValveState = null;

// Helper function to set valve state (opposite of light)
function setValve(on) {
    if (!valveIp) {
        return;
    }

    if (httpBusy) {
        // Queue the latest desired state
        pendingValveState = on;
        print("HTTP busy, queued valve state: " + on);
        return;
    }

    httpBusy = true;
    Shelly.call("HTTP.GET", {
        url: "http://" + valveIp + "/rpc/Switch.Set?id=0&on=" + on
    }, function (result, error_code, error_message) {
        httpBusy = false;
        if (error_code !== 0) {
            print("Valve error: " + error_message);
        } else {
            print("Valve set to " + on);
        }

        // Process pending request if any
        if (pendingValveState !== null) {
            let nextState = pendingValveState;
            pendingValveState = null;
            setValve(nextState);
        }
    });
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

HTTPServer.registerEndpoint('', function (req, res) {
    let durationSec = duration / 1000;
    res.code = 200;
    res.headers = [["Content-Type", "text/html"]];
    res.body = '<!DOCTYPE html><html><head><title>Valve Timer</title></head><body>' +
        '<h2>Valve Timer State</h2>' +
        '<p><b>Duration:</b> ' + durationSec + ' seconds</p>' +
        '<p><b>Valve IP:</b> ' + (valveIp || 'not set') + '</p>' +
        '<p><b>Learning:</b> ' + (isLearning ? 'yes' : 'no') + '</p>' +
        '<hr>' +
        '<h3>Step 1: Calculate Flow Rate</h3>' +
        '<label>Liters during duration: <input type="number" id="liters" step="0.1" oninput="calc()"></label>' +
        '<p id="result">Flow rate: -- liters/hour</p>' +
        '<hr>' +
        '<h3>Step 2: Set Duration for Desired Liters</h3>' +
        '<label>Desired liters: <input type="number" id="desiredLiters" step="0.1" oninput="calcDuration()"></label>' +
        '<p id="newDuration">Required duration: -- seconds</p>' +
        '<button onclick="setDuration()">Set Duration</button>' +
        '<p id="status"></p>' +
        '<script>' +
        'var lph=0;' +
        'function calc(){' +
        'var liters=parseFloat(document.getElementById("liters").value)||0;' +
        'lph=liters*3600/' + durationSec + ';' +
        'document.getElementById("result").innerText="Flow rate: "+lph.toFixed(2)+" liters/hour";' +
        'calcDuration();' +
        '}' +
        'function calcDuration(){' +
        'var desired=parseFloat(document.getElementById("desiredLiters").value)||0;' +
        'if(lph>0){' +
        'var secs=desired*3600/lph;' +
        'document.getElementById("newDuration").innerText="Required duration: "+secs.toFixed(1)+" seconds";' +
        '}else{' +
        'document.getElementById("newDuration").innerText="Required duration: -- (enter liters first)";' +
        '}' +
        '}' +
        'function setDuration(){' +
        'var desired=parseFloat(document.getElementById("desiredLiters").value)||0;' +
        'if(lph<=0){alert("Calculate flow rate first");return;}' +
        'var ms=Math.round(desired*3600000/lph);' +
        'fetch("/rpc/KVS.Set?key=duration&value="+ms)' +
        '.then(function(){document.getElementById("status").innerText="Duration set to "+ms+"ms. Reload page.";})' +
        '.catch(function(e){document.getElementById("status").innerText="Error: "+e;});' +
        '}' +
        '</script>' +
        '</body></html>';
    res.send();
});