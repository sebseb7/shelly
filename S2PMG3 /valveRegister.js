// Script for the VALVE Shelly device
// Registers its IP with the S2PM controller on startup

let ctrlIp = "192.168.33.1";
let scriptId = 1;

function register() {
    Shelly.call("Wifi.GetStatus", {}, function (r, e) {
        if (e === 0 && r && r.sta_ip) {
            let url = "http://" + ctrlIp + "/script/" + scriptId + "/api?a=setip&v=" + r.sta_ip;
            Shelly.call("HTTP.GET", { url: url }, function (res, err) {
                print(err === 0 ? "Registered: " + r.sta_ip : "Failed");
            });
        }
    });
}

// Register on startup and every minute
register();
Timer.set(60000, true, register);
