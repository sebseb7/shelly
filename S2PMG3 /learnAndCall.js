let duration = 0;
let isLearning = false;
let startTime = 0;
let callTimer = null;
let valveIp = null;
let valveLastSeen = 0;
let valveFirstRegister = true;

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
            duration = Math.round((Date.now() - startTime) / 100) * 100;
            Shelly.call("Switch.Set", { id: 1, on: true });
            setValve(false);
            // Save duration to persistent storage
            Shelly.call("KVS.Set", { key: "duration", value: duration });
            print("Learning stopped - duration: " + duration + "ms (saved)");
        }
    }

    // Button 0: Call button - turn on for learned duration
    if (e.info.id === 0 && e.info.event === 'btn_down') {
        doCallAction();
    }
});

// Call action - can be triggered by button or HTTP
function doCallAction() {
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

// Check KVS every 5 seconds for duration changes
Timer.set(5000, true, function () {
    Shelly.call("KVS.Get", { key: "duration" }, function (result, error_code, error_message) {
        if (error_code === 0 && result && result.value) {
            if (result.value !== duration) {
                duration = result.value;
                print("Duration updated from KVS: " + duration + "ms");
            }
        }
    });
});

HTTPServer.registerEndpoint('', function (req, res) {
    let s = duration / 1000;
    res.code = 200;
    res.headers = [["Content-Type", "text/html"]];
    res.body = '<html><head><meta name=viewport content="width=device-width"><style>' +
        'body{font-family:sans-serif;background:#9b9;margin:0;padding:8px}' +
        '.c{max-width:400px;margin:0 auto;background:#fec;padding:10px;border-radius:8px;border:2px solid #850}' +
        'h2,h3{margin:8px 0;color:#350}p{margin:4px 0}' +
        'input{padding:4px;border:1px solid #850;width:80px;font-size:16px}' +
        '#P{width:140px;margin-right:8px}' +
        'button{background:#6a3;color:#fff;border:1px solid #350;padding:8px 12px;margin:4px 0;font-size:14px}' +
        '.r{background:#d50;width:100%;padding:12px;font-size:18px}' +
        '.l{background:#28a}' +
        '</style></head><body><div class=c>' +
        '<h2>Valve Timer</h2>' +
        '<p>Duration: <b id=d>' + s.toFixed(1) + '</b>s | IP: <b id=v>' + (valveIp || '-') + '</b> (seen: <span id=T>' + (valveLastSeen > 0 ? Math.round((Date.now() - valveLastSeen) / 60000) : '-') + '</span>m) | Learn: <b id=L>' + (isLearning ? 'Y' : 'N') + '</b></p>' +
        '<button class=r onclick="f(1)">Run ' + s.toFixed(1) + 's</button>' +
        '<h3>Flow Calc</h3>' +
        '<p>Liters: <input id=i oninput=C()> = <span id=R>--</span> L/h</p>' +
        '<h3>Set Liters</h3>' +
        '<p>Want: <input id=w oninput=D()> = <span id=N>--</span>s</p>' +
        '<button onclick=S()>Set</button><span id=E></span>' +
        '<h3>Settings</h3>' +
        '<p>IP: <input id=P value="' + (valveIp || '') + '"><button onclick="f(3)">Save</button></p>' +
        '<p>' + (isLearning ? '<button class=l onclick="f(2)">Stop</button>' : '<button class=l onclick="if(confirm(String.fromCharCode(83,116,97,114,116,63)))f(2)">Learn</button>') + '</p>' +
        '<script>' +
        'var p=0,s=' + s + ',A="/script/1/api?a=";' +
        'function f(n){var u=n==1?"call":n==2?"learn":"setip&v="+P.value;fetch(A+u).then(function(){location.reload()})}' +
        'function C(){var l=+i.value||0;p=l*3600/s;R.innerText=p.toFixed(1)}' +
        'function D(){if(p>0)N.innerText=(+w.value*3600/p).toFixed(1)}' +
        'function S(){if(p<=0)return alert("Calc first");fetch(A+"setms&v="+Math.round(+w.value*3600000/p)).then(function(){location.reload()})}' +
        'setInterval(function(){fetch(A+"state").then(function(r){return r.json()}).then(function(x){d.innerText=(x.duration/1000).toFixed(1);v.innerText=x.valveIp||"-";L.innerText=x.isLearning?"Y":"N";T.innerText=x.valveLastSeen>0?Math.round((Date.now()-x.valveLastSeen)/60000):"-"})},5000)' +
        '</script></div></body></html>';
    res.send();
});

// Single API endpoint to handle all actions
HTTPServer.registerEndpoint('api', function (req, res) {
    // Parse query string
    let params = {};
    if (req.query) {
        let parts = req.query.split('&');
        for (let i = 0; i < parts.length; i++) {
            let kv = parts[i].split('=');
            params[kv[0]] = kv[1];
        }
    }

    let action = params.a || 'state';
    res.code = 200;

    if (action === 'state') {
        res.headers = [["Content-Type", "application/json"]];
        res.body = JSON.stringify({ duration: duration, valveIp: valveIp, isLearning: isLearning, valveLastSeen: valveLastSeen });
    } else if (action === 'call') {
        doCallAction();
        res.body = "OK";
    } else if (action === 'learn') {
        if (!isLearning) {
            isLearning = true;
            startTime = Date.now();
            Shelly.call("Switch.Set", { id: 1, on: false });
            setValve(true);
            res.body = "Learning started";
        } else {
            isLearning = false;
            duration = Math.round((Date.now() - startTime) / 100) * 100;
            Shelly.call("Switch.Set", { id: 1, on: true });
            setValve(false);
            Shelly.call("KVS.Set", { key: "duration", value: duration });
            res.body = "Stopped: " + duration + "ms";
        }
    } else if (action === 'setms' && params.v) {
        let ms = parseInt(params.v);
        if (!isNaN(ms) && ms > 0) {
            duration = ms;
            Shelly.call("KVS.Set", { key: "duration", value: ms });
            res.body = "OK";
        } else {
            res.code = 400;
            res.body = "Invalid";
        }
    } else if (action === 'setip' && params.v) {
        valveIp = params.v;
        valveLastSeen = Date.now();
        Shelly.call("KVS.Set", { key: "valveIp", value: params.v });
        // Flicker 3x on first registration only, if not learning or call active
        if (valveFirstRegister && !isLearning && callTimer === null) {
            valveFirstRegister = false;
            let count = 0;
            let flickerTimer = Timer.set(400, true, function () {
                count++;
                Shelly.call("Switch.Set", { id: 1, on: count % 2 === 0 });
                if (count >= 6) Timer.clear(flickerTimer);
            });
        }
        res.body = "OK";
    } else {
        res.code = 400;
        res.body = "Unknown action";
    }
    res.send();
});