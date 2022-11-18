const labels = new Labels();

const createExtensionInstance = () => new Candor(Web3, labels);

window.addEventListener("load", function() {
    const objCandor = createExtensionInstance();
});

//Send message from the extension to here.
objBrowser.runtime.onMessage.addListener(
    function(request, sender, sendResponse) {
        let objCandor = createExtensionInstance();

        if (typeof request.func !== "undefined") {
            if(typeof objCandor[request.func] == "function") {
                objCandor[request.func]();
                sendResponse({status: "ok"});
                return true;
            }
        }

        sendResponse({status: "fail"});
    }
);
