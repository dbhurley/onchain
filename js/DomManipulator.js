let objBrowser = chrome ? chrome : browser;

const EXT_PREFIX = 'ext-candor';
const HOVER_POPUP_CLASS_NAME = `${EXT_PREFIX}-address_stats_hover`;
const ADDRESS_DISPLAY_POPUP_CLASS_NAME = `${EXT_PREFIX}-display-popup`;
const ATTRIBUTE_ADDRESS_UNIQUE_ID = `data-${EXT_PREFIX}-address-unique-id`;
const LABEL_LOADED_ATTRIBUTE = `data-${EXT_PREFIX}-label-loaded`;

class Candor {
    constructor(objWeb3, labels)
    {
        this.objWeb3 = objWeb3;
        this._labels = labels;

        this.strRpcDetails = "";
        this.candor_score = "";

        this.setDefaultExtensionSettings();
        this.init();

        this.event_0xAddressMouseEnter = this.event_0xAddressMouseEnter.bind(this);
        this.event_0xAddressMouseLeave = this.event_0xAddressMouseLeave.bind(this);
    }

    setDefaultExtensionSettings() {
        this.blHighlight = false;
        this.blPerformAddressLookups = true;
        this.strBlockchainExplorer = "https://etherscan.io/address";
        this.strRpcProvider = "https://localhost:8545";

        this.intSettingsCount = 0;
        this.intSettingsTotalCount = 2;
    }

    /**
     * @name init
     * @desc Gets extension settings and applies DOM manipulation
     */
    init()
    {
        let objBrowser = chrome ? chrome : browser;
        //Get the highlight option for the user
        objBrowser.runtime.sendMessage({func: "highlight_option"}, function(objResponse) {
            if(objResponse && objResponse.hasOwnProperty("resp")) {
                this.blHighlight = (objResponse.resp == 1);
            }
            ++this.intSettingsCount;
        }.bind(this));

        //Get the blockchain explorer for the user
        objBrowser.runtime.sendMessage({func: "blockchain_explorer"}, function(objResponse) {
            this.strBlockchainExplorer = objResponse.resp;
            ++this.intSettingsCount;
        }.bind(this));

        //Get the perform address lookup option
        objBrowser.runtime.sendMessage({func: "perform_address_lookups"}, function(objResponse) {
            this.blPerformAddressLookups = objResponse.resp;
            ++this.intSettingsCount;
        }.bind(this));

        //Get the RPC network details
        objBrowser.runtime.sendMessage({ func: "rpc_details" }, function(objResponse) {
            let objDetails = JSON.parse(objResponse.resp);
            this.strRpcDetails = `${objDetails.name} (${objDetails.type})`;
        }.bind(this));

        //Update the DOM once all settings have been received...
        setTimeout(function() {
            // Needs to happen after user settings have been collected
            // and in the context of init();
            this.setSearchAndReplaceSettings();
            this.setWarningSettings();
            this.manipulateDOM();
        }.bind(this), 10);
    }

    /**
     * @name Set Search And Replace Settings
     * @desc
     */
    setSearchAndReplaceSettings()
    {
        // Check user is on their favourite block explorer, on fail target blank.
        this.target = (this.isBlockchainExplorerSite() ? '_self' : '_blank');

        // Register RegEx Patterns
        this.regExPatterns = [
            // Ethereum Address Regex
            /(^|\s|:|-)((?:0x)[0-9a-fA-F]{40})(\s|$)/gi,

            // ENS Address Regex
            /(^|\s|:|-)([a-z0-9][a-z0-9-.]+[a-z0-9](?:\.eth))(\s|$)/gi,

            // ENS With ZWCs
            /(^|\s|:|-)([a-z0-9][a-z0-9-.]*(\u200B|\u200C|\u200D|\uFEFF|\u2028|\u2029|&zwnj;|&#x200c;)[a-z0-9]*(?:\.eth))(\s|$)/gi
        ];

        // Register RegEx Matching Patterns
        this.matchPatterns = [
            // Ethereum Match Pattern
            /((?:0x)[0-9a-fA-F]{40})/gi,

            // ENS Match Pattern
            this.regExPatterns[1],

            // ENS With ZWCs
            this.regExPatterns[2]
        ];

        // Register Replace Patterns
        this.replacePatterns = [
            // Ethereum Address Replace
            '$1<a href="' + this.strBlockchainExplorer + '/$2" ' +
            'data-address="$2"' +
            'class="ext-candor-link ext-candor-0xaddress" ' +
            'target="'+ this.target +'">' +
            '<div class="ext-candor-blockie" data-ether-address="$2" ></div> $2' +
            '</a>$3',

            // ENS Address Replace
            '$1<a title="See this address on the blockchain explorer" ' +
            'href="' + this.strBlockchainExplorer + '/$2" ' +
            'data-address="$2"' + 
            'class="ext-candor-link ext-candor-0xaddress" ' +
            'target="'+ this.target +'">' +
            '<div class="ext-candor-blockie" data-ether-address="$2" ></div> $2' +
            '</a>$3',

            // ENS With ZWCs Replace
            '$1<slot title="WARNING! This ENS address has ZWCs. Someone may be trying to scam you." ' +
            'class="ext-candor-warning">$2</slot>$3'
        ];
    }

    /**
     * @name Set Warning Settings
     * @desc
     */
    setWarningSettings()
    {
        // The block explorers that can handle ENS addresses
        this.ENSCompatiableExplorers = [
            "https://etherscan.io/address",
            "https://etherchain.org/account"
        ];

        // Does the user's favorite explorer support an ENS address
        for(var i=0; i<this.ENSCompatiableExplorers.length; i++){
            if(this.strBlockchainExplorer == this.ENSCompatiableExplorers[i]){
                this.ENSCompatiable = true;
                break;
            }
            this.ENSCompatiable = false;
        }

        // On failure give the user a warning.
        if(!this.ENSCompatiable){
            this.replacePatterns[1] = '$1<a title="Notification! We have spotted an ENS address, your current block explorer can\'t parse this address. Please choose a compatible block explorer." ' +
                'class="ext-candor-link ext-candor-warning" href="#">$2</a>$3';
        }
    }

    manipulateDOM()
    {
        if (this.blBlacklistDomains) {
            this.blacklistedDomainCheck();
        }

        this.convertAddressToLink();

        if (this.blPerformAddressLookups > 0) {
            this.setAddressOnHoverBehaviour();
        }
    }

    /**
     * @name Convert Address To Link
     * @desc Finds Ethereum addresses and converts to a link to a block explorer
     */
    convertAddressToLink()
    {
        var arrWhitelistedTags = ["div", "code", "span", "p", "td", "li", "em", "i", "b", "strong", "small"];

        //Get the whitelisted nodes
        for(var i=0; i<arrWhitelistedTags.length; i++) {
            var objNodes = document.getElementsByTagName(arrWhitelistedTags[i]);
            //Loop through the whitelisted content
            for(var x=0; x<objNodes.length; x++) {

                if(this.hasIgnoreAttributes(objNodes[x])){
                    continue;
                }

                this.convertAddresses(objNodes[x]);
            }
        }

        this.tidyUpSlots();
        this.addBlockies();

        if(this.blHighlight) {
            this.addHighlightStyle();
        }
    }

    /**
     * @name Convert Addresses
     * @desc Takes a Node and checks if any of its children are textNodes. On success replace textNode with slot node
     * @desc slot node contains regex replaced content; see generateReplacementContent()
     * @param {Node} objNode
     */
    convertAddresses(objNode)
    {
        // Some nodes have non-textNode children
        // we need to ensure regex is applied only to text otherwise we will mess the html up
        for(var i=0; i < objNode.childNodes.length; i++){
            // Only check textNodes to prevent applying RegEx against element attributes
            if(objNode.childNodes[i].nodeType == 3){ // nodeType 3 = a text node

                var child = objNode.childNodes[i];
                var childContent = child.textContent;

                // Only start replacing stuff if the we get a RegEx match.
                if(this.isPatternMatched(childContent)) {
                    // https://developer.mozilla.org/en-US/docs/Web/HTML/Element/slot
                    var replacement = document.createElement('slot');
                    replacement.setAttribute('class', 'ext-candor-temporary');
                    replacement.innerHTML = this.generateReplacementContent(childContent);
                    objNode.replaceChild(replacement, child);
                }
            }
        }
    }

    /**
     * @name Generate Replacement Content
     * @desc Takes string and replaces any regex pattern matches with the associated replace patterns
     * @param {string} content
     * @returns {string}
     */
    generateReplacementContent(content)
    {
        for(var i=0; i < this.regExPatterns.length; i++){
            content = content.replace(this.regExPatterns[i], this.replacePatterns[i]);
        }
        return content;
    }

    /**
     * @name Has Ignore Attributes
     * @desc Checks if a node contains any attribute that we want to avoid manipulating
     * @param {Element} node
     * @returns {boolean}
     */
    hasIgnoreAttributes(node)
    {
        var ignoreAttributes = {
            "class": ["ng-binding"]
        };

        // Loop through all attributes we want to test for ignoring
        for(var attributeName in ignoreAttributes){
            // Filter out the object's default properties
            if (ignoreAttributes.hasOwnProperty(attributeName)) {

                // Check this node has the attribute we are currently checking for
                if(node.hasAttribute(attributeName)){

                    // This node's value for the attribute we are checking
                    var nodeAttributeValue = node.getAttribute(attributeName);
                    // The values we want to ignore for this attribute
                    var badAttributeValueList = ignoreAttributes[attributeName];

                    // Loop through the attribute values we want to ignore
                    for(var i=0; i < badAttributeValueList.length; i++){
                        // If we find an indexOf, this value is present in the attribute
                        if(nodeAttributeValue.indexOf(badAttributeValueList[i]) !== -1){
                            return true;
                        }
                    }

                }

            }
        }

        return false;
    }

    /**
     * @name Is Pattern Matched
     * @desc Checks content matches any of the object's matchPatterns
     * @param {string} content
     * @returns {boolean}
     */
    isPatternMatched(content)
    {
        for(var i=0; i < this.matchPatterns.length; i++){
            if(this.matchPatterns[i].exec(content) !== null){
                return true;
            }
        }
        return false;
    }

    /**
     * @name Is Blockchain Explorer Site
     * @desc Check if the current website is the user's selected block explorer
     * @returns {boolean}
     */
    isBlockchainExplorerSite()
    {
        var objBlockchainExplorer = document.createElement("a");
        objBlockchainExplorer.href = this.strBlockchainExplorer;
        return (objBlockchainExplorer.hostname === window.location.hostname);
    }

    /**
     * @name Tidy Slots
     * @desc Searches document for slots adds the slot's child nodes to its parent then removes the slot
     */
    tidyUpSlots()
    {
        var slots = document.querySelectorAll("slot.ext-candor-temporary");
        for(var i=0; i < slots.length; i++){
            while(slots[i].childNodes.length > 0){
                slots[i].parentNode.insertBefore(slots[i].firstChild, slots[i]);
            }
            slots[i].parentNode.removeChild(slots[i]);
        }
    }

    async addBlockies()
    {
        var blockieDivs = document.querySelectorAll("div.ext-candor-blockie");
        
        for(var i = 0; i < blockieDivs.length; i++){    
            
            if ((blockieDivs[i].getAttribute('data-ether-address').toLowerCase()).endsWith('.eth')) {
                var web3 = new Web3(new Web3.providers.HttpProvider('https://mainnet.infura.io/v3/02b145caa61b49998168f2b97d4ef323'));
                let newAddress = await web3.eth.ens.getAddress(blockieDivs[i].getAttribute('data-ether-address').toLowerCase()).then(result => {
                    blockieDivs[i].setAttribute('data-ether-address', result);
                });
            } 

            let candorAvatar = await fetch('https://api.candor.io/api/address/' + blockieDivs[i].getAttribute('data-ether-address').toLowerCase())
            .then((response) => response.json())
            .then((data) => {
                data.score = data.score * 4;
                if (data.score <= 10 ) {
                    blockieDivs[i].style.backgroundImage = 'url(https://github.com/WithCandor/assets/blob/main/candor-danger-1x.png?raw=true)';
                } else if (data.score <= 50) {
                        blockieDivs[i].style.backgroundImage = 'url(https://github.com/WithCandor/assets/blob/main/candor-warning-icon-1x.png?raw=true)';
                } else if (data.score <= 75) {
                        blockieDivs[i].style.backgroundImage = 'url(https://github.com/WithCandor/assets/blob/main/candor-neutral-1x.png?raw=true)';
                } else if (data.score <= 100) {
                        blockieDivs[i].style.backgroundImage = 'url(https://github.com/WithCandor/assets/blob/main/candor-safe-1x.png?raw=true)';
                } else {
                        blockieDivs[i].style.backgroundImage = 'url(https://github.com/WithCandor/assets/blob/main/candor-neutral-1x.png?raw=true)';
                }
            });
            
            // blockieDivs[i].style.backgroundImage = 'url(' + blockies.create({
            //     // toLowerCase is used because standard blockies are based on none-checksum Ethereum addresses
            //     seed:blockieDivs[i].getAttribute('data-ether-address').toLowerCase(),
            //     size: 8,
            //     scale: 16
            // }).toDataURL() +')';
        }
    }

    //Removes the highlight style from Ethereum addresses
    removeHighlightStyle()
    {
        var objEtherAddresses = document.getElementsByClassName("ext-candor-link");
        for (var i = 0; i < objEtherAddresses.length; i++) {
            objEtherAddresses[i].classList.add("ext-candor-link-no_highlight");
            objEtherAddresses[i].classList.add("ext-candor-link-highlight");
        }
        return false;
    }

    //Adds the highlight style
    addHighlightStyle()
    {
        var objEtherAddresses = document.getElementsByClassName("ext-candor-link");
        for (var i = 0; i < objEtherAddresses.length; i++) {
            objEtherAddresses[i].classList.add("ext-candor-link-highlight");
            objEtherAddresses[i].classList.remove("ext-candor-link-no_highlight");
        }
        return false;
    }

    //Sets the on hover behaviour for the address
    // - get the address stats with rpc
    async setAddressOnHoverBehaviour()
    {
        var objNodes = document.getElementsByClassName("ext-candor-0xaddress");
        for (var i = 0; i < objNodes.length; i++) {
            const address = objNodes[i].getAttribute("data-address");
            if (address.endsWith('.eth')) {
                var web3 = new Web3(new Web3.providers.HttpProvider('https://mainnet.infura.io/v3/02b145caa61b49998168f2b97d4ef323'));
                let newAddress = await web3.eth.ens.getAddress(address).then(result => {
                    objNodes[i].setAttribute("data-address", result);
                });
            } 
            objNodes[i].addEventListener('mouseenter', this.event_0xAddressMouseEnter, false);
            objNodes[i].addEventListener('mouseleave', this.event_0xAddressMouseLeave, false);
        }
    }

    event_0xAddressMouseLeave(event) {
        const addressElement = event.target;

        this.hidePopupTimer = setTimeout(() => {
            addressElement.classList.remove(ADDRESS_DISPLAY_POPUP_CLASS_NAME);
        }, 100);
    }

    //The event handler for 0x address mouseover.
    //It will do the logic to call the web3 rpc to get the address balance.
    event_0xAddressMouseEnter(event) {
        const addressElement = event.target;
        const address = addressElement.getAttribute("data-address");
        
        // if (address.endsWith('.eth')) {
        //     let newAddress = web3.eth.ens.getAddress(address).then(result => {
        //         addressElement.setAttribute("data-address", result);
        //     });
        // } 

        let uniqueAddressId = addressElement.getAttribute(ATTRIBUTE_ADDRESS_UNIQUE_ID);

        if (!uniqueAddressId) {
            uniqueAddressId = (new Date()).getTime();

            addressElement.setAttribute(ATTRIBUTE_ADDRESS_UNIQUE_ID, uniqueAddressId);
        }

        if (!addressElement.classList.contains(ADDRESS_DISPLAY_POPUP_CLASS_NAME)) {

           if(document.querySelector(`.${ADDRESS_DISPLAY_POPUP_CLASS_NAME}`)) {
               document.querySelector(`.${ADDRESS_DISPLAY_POPUP_CLASS_NAME}`).classList.remove(ADDRESS_DISPLAY_POPUP_CLASS_NAME)
           }

            addressElement.classList.add(ADDRESS_DISPLAY_POPUP_CLASS_NAME);
        }

        if (addressElement.children.length > 1 && addressElement.children[1].className === HOVER_POPUP_CLASS_NAME) {
            if (this.hidePopupTimer) {
                clearTimeout(this.hidePopupTimer);
            }
        } else {
            var objHoverNode = document.createElement("div");
            objHoverNode.className = HOVER_POPUP_CLASS_NAME;
            const objHoverNodeContent = document.createElement("div");
            objHoverNodeContent.className = `${HOVER_POPUP_CLASS_NAME}_content`;
            objHoverNodeContent.innerHTML = `
                <p id='${EXT_PREFIX}-fetching_data_${uniqueAddressId}'>
                    <strong>Fetching Data...</strong>
                </p>
                <div id='candor-popover-phi-label_${uniqueAddressId}'></div>
                <div id='candor-tooltip-bg' class=''>
                <!--<span id='candor-tooltip-status-label'>status</span><span id='candor-tooltip-status'>unverified contract</span>-->
                <div id='${EXT_PREFIX}-address_stats_hover_node_error_${uniqueAddressId}' class='${EXT_PREFIX}-address_stats_hover_node_error'></div>
                <div id='${EXT_PREFIX}-address_stats_hover_node_ok_${uniqueAddressId}' class='${EXT_PREFIX}-address_stats_hover_node_ok'></div>
                <ul id="candor-popover-details">
                    <li id='${EXT_PREFIX}-score_${uniqueAddressId}'></li>
                    <li id='${EXT_PREFIX}-address_balance_${uniqueAddressId}'></li>
                    <li id='${EXT_PREFIX}-transactions_out_${uniqueAddressId}'></li>
                    <li id='${EXT_PREFIX}-contract_address_${uniqueAddressId}'></li>
                </ul>
                <span class="${EXT_PREFIX}-label_${uniqueAddressId}" ${LABEL_LOADED_ATTRIBUTE}="false"></span></div>`;


            objHoverNode.appendChild(objHoverNodeContent);
            addressElement.appendChild(objHoverNode);
          

            //Get the RPC provider for the user
            objBrowser.runtime.sendMessage({ func: "rpc_provider" }, (objResponse) => {

                var web3 = new Web3(new Web3.providers.HttpProvider(objResponse.resp));
               
                var str0xAddress = addressElement.getAttribute("data-address");

                const objHoverNodeContent = addressElement.children[1].children[0];

                let status = fetch('https://api.candor.io/api/address/' + addressElement.getAttribute("data-address"))
                    .then((response) => response.json())
                    .then((data) => {
                        if(objHoverNodeContent.children[0].id == "ext-candor-fetching_data_"+uniqueAddressId) {
                            objHoverNodeContent.children[0].style.display = 'none';
                        }

                        // var objScore = objHoverNodeContent.querySelector("#ext-candor-status_"+uniqueAddressId);
                        // objScore.innerHTML = "<span class='candor-popover-label'>status</span> "+ data.status;
                        var objWarningLabel = objHoverNodeContent.querySelector("#candor-popover-phi-label_"+uniqueAddressId);

                        data.score = data.score * 4;
                        if (data.score < 10 ) {
                            objHoverNodeContent.querySelector("#candor-tooltip-bg").className = 'candor-popover-danger';
                            objWarningLabel.innerHTML = "<span class='candor-popover-phi-label phi-label-danger'>This " + data.chains[1].type + " might be a scam</span>";
                            // objHoverNodeContent.querySelector("#ext-candor-address_stats_hover_node_ok_"+uniqueAddressId).innerHTML = "<div class='candor-popover-danger-avatar'></div>";
                        
                        } else if (data.score < 50) {
                            objHoverNodeContent.querySelector("#candor-tooltip-bg").className = 'candor-popover-warning';
                            objWarningLabel.innerHTML = "<span class='candor-popover-phi-label phi-label-warning'>This " + data.chains[1].type + " is dangerous</span>";
                            // objHoverNodeContent.querySelector("#ext-candor-address_stats_hover_node_ok_"+uniqueAddressId).innerHTML = "<div class='candor-popover-warning-avatar'></div>";

                        } else if (data.score < 75) {
                            objHoverNodeContent.querySelector("#candor-tooltip-bg").className = 'candor-popover-neutral';
                            objWarningLabel.innerHTML = "<span class='candor-popover-phi-label phi-label-neutral'>This " + data.chains[1].type + " is neutral/span>";
                            // objHoverNodeContent.querySelector("#ext-candor-address_stats_hover_node_ok_"+uniqueAddressId).innerHTML = "<div class='candor-popover-neutral-avatar'></div>";

                        } else if (data.score < 100) {
                            objHoverNodeContent.querySelector("#candor-tooltip-bg").className = 'candor-popover-safe';
                            objWarningLabel.innerHTML = "<span class='candor-popover-phi-label phi-label-safe'>This " + data.chains[1].type + " is safe</span>";
                            // objHoverNodeContent.querySelector("#ext-candor-address_stats_hover_node_ok_"+uniqueAddressId).innerHTML = "<div class='candor-popover-safe-avatar'></div>";

                        } else {
                            objHoverNodeContent.querySelector("#candor-tooltip-bg").className = 'candor-popover-pending';
                            objWarningLabel.innerHTML = "<span class='candor-popover-phi-label phi-label-neutral'>This " + data.chains[1].type + " is pending</span>";
                            // objHoverNodeContent.querySelector("#ext-candor-address_stats_hover_node_ok_"+uniqueAddressId).innerHTML = "<div class='candor-popover-pending-avatar'></div>";
                        }


                        var objScore = objHoverNodeContent.querySelector("#ext-candor-score_"+uniqueAddressId);
                        objScore.innerHTML = "<span class='candor-popover-label'>Φ score</span> "+ data.score + "%";
                });

                //Get transaction count
                web3.eth.getTransactionCount(str0xAddress).then(result => {
                    if(objHoverNodeContent.children[0].id == "ext-candor-fetching_data_"+uniqueAddressId) {
                        objHoverNodeContent.children[0].style.display = 'none';
                    }

                    var intTransactionCount = "";
                    objHoverNodeContent.querySelector("#ext-candor-address_stats_hover_node_ok_"+uniqueAddressId).style.display = "inline";
                    // objHoverNodeContent.querySelector("#ext-candor-address_stats_hover_node_ok_"+uniqueAddressId).innerText = "👍";
                    intTransactionCount = parseInt(result).toLocaleString();

                    var objTransactionCount = objHoverNodeContent.querySelector("#ext-candor-transactions_out_"+uniqueAddressId);
                    objTransactionCount.innerHTML = "<span class='candor-popover-label'>transactions</span> "+ intTransactionCount;
                });

                //Get the account balance
                web3.eth.getBalance(str0xAddress).then(result => {
                    if (objHoverNodeContent.children[0].id == "ext-candor-fetching_data_"+uniqueAddressId) {
                        objHoverNodeContent.children[0].style.display = 'none';
                    }

                    var flEthBalance = "";
                    objHoverNodeContent.querySelector("#ext-candor-address_stats_hover_node_ok_"+uniqueAddressId).style.display = "inline";
                    // objHoverNodeContent.querySelector("#ext-candor-address_stats_hover_node_ok_"+uniqueAddressId).innerText = "👍";
                    flEthBalance = web3.utils.fromWei(result.toString(10), "ether").toLocaleString("en-US", {maximumSignificantDigits: 9});

                    var objAddressBalance = objHoverNodeContent.querySelector("#ext-candor-address_balance_"+uniqueAddressId);
                    objAddressBalance.innerHTML += "<span class='candor-popover-label'>balance</span> "+ flEthBalance.slice(0,5) + " Ξ";
                });

                //See if the address is a contract
                web3.eth.getCode(str0xAddress).then(result => {
                    if (objHoverNodeContent.children[0].id == "ext-candor-fetching_data_"+uniqueAddressId) {
                        objHoverNodeContent.children[0].style.display = 'none';
                    }

                    var objContractAddress = objHoverNodeContent.querySelector("#ext-candor-contract_address_"+uniqueAddressId);

                    objHoverNodeContent.querySelector("#ext-candor-address_stats_hover_node_ok_"+uniqueAddressId).style.display = "inline";
                    // objHoverNodeContent.querySelector("#ext-candor-address_stats_hover_node_ok_"+uniqueAddressId).innerText = "👍";
                    var blIsContractAddress = result == "0x" ? false : true;
                    if (blIsContractAddress) {
                        objContractAddress.innerHTML += "<small>This is a contract address</small>";
                    }
                });

                /** 
                if (objResponse.resp.includes("quiknode.io")) {
                    objHoverNodeContent.innerHTML += `<div style="position:absolute;right:1em;bottom:0.5em;">
                        <a href='https://www.quiknode.io?tap_a=22610-7a7484&tap_s=150933-0c5904' target='_blank' title='RPC node managed by Quiknode.io'>
                            <img height="15px"src='${objBrowser.runtime.getURL("/images/powered-by-quiknode.png")}' />
                        </a>
                    </div>`;
                }
                */

                // objHoverNodeContent.innerHTML += `<div style="position:absolute;bottom:0.5em;">
                //     <span style="font-size: 7pt"><strong>NETWORK:</strong> ${this.strRpcDetails}</span>
                // </div>`;
            });
        }

        setTimeout(() => {
            this.addLabelsHTML(address, uniqueAddressId);
        }, 0);

        return false;
    }

    async addLabelsHTML(address, id) {
        const labelElement = document.querySelector(`.${EXT_PREFIX}-label_${id}`);

        const labelLoaded = labelElement.getAttribute(LABEL_LOADED_ATTRIBUTE) === 'true';

        if (labelLoaded) {
            return;
        }

        const retrievedLabel = await this._labels.getLabelForAddress(address);

        if (retrievedLabel) {
            const { color, label } = retrievedLabel;

            labelElement.innerHTML = this._labels.getTemplate(label, color);
        } else {
            labelElement.innerHTML = '';
        }

        labelElement.setAttribute(LABEL_LOADED_ATTRIBUTE, 'true');
    }

    resetLoadedLabels() {
        document.querySelectorAll(`[${LABEL_LOADED_ATTRIBUTE}]`).forEach(element => {
            element.setAttribute(LABEL_LOADED_ATTRIBUTE, 'false');
        });
    }
}
