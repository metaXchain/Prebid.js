import Adapter from 'src/adapters/adapter';
import bidfactory from 'src/bidfactory';
import bidmanager from 'src/bidmanager';
import * as utils from 'src/utils';
import { ajax } from 'src/ajax';
import { STATUS } from 'src/constants';

let ENDPOINT = 'https://vidroll-rtb-server-staging-2.azurewebsites.net/proxy';

/**
 * Bidder adapter for /ut endpoint. Given the list of all ad unit tag IDs,
 * sends out a bid request. When a bid response is back, registers the bid
 * to Prebid.js. This adapter supports alias bidding.
 */
function MetaXchainAdapter() {

  let baseAdapter = Adapter.createNew('metaxchain');
  let bidRequests = {};
  let usersync = false;
  const ox = `//c1.ox-bio.com/t0?oxtrk=109&oxhrt=98d42168-158c-4e75-9049-0dd9d9b08aa5&oxuid=VID0001&ad-id1=`;

  let  openrtbBidRequest = {
    "at": 2,          // auction type
    "tmax": 120,      // timeout max
    "imp": [],
    "site": {
      "name": window.top.document.title,     // Site name
      "domain": utils.getTopWindowLocation().hostname,
      "page": utils.getTopWindowUrl(),
      "ref": document.referrer,
    },
    "device": {
      "ip": "",
      "ua": window.navigator.userAgent,
      "os": "",
      "dnt": 0          // 1 - do not track
    }
  };

  function getParameterByName(name) {
    var regexS = '[\\?&]' + name + '=([^&#]*)';
    var regex = new RegExp(regexS);
    var results = regex.exec(window.location.search);
    if (results === null) {
      return '';
    }

    return decodeURIComponent(results[1].replace(/\+/g, ' '));
  };

  function appendScript(src, callback) {
    var s,
    r;
    r=false;
    s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = s.onreadystatechange = function() {
      // console.log( this.readyState ); //uncomment this line to see which ready states are called.
      if ( !r && (!this.readyState || this.readyState == 'complete') )
      {
        r = true;
        callback();
      }
    };
    document.body.appendChild(s);
  }

  function loadScript(src, callback) {
    if (document.readyState === "complete" || document.readyState === "interactive") {
      appendScript(src, callback);
    } else {
      document.addEventListener("DOMContentLoaded", function(event) { 
        appendScript(src, callback);
      });
    }
  }

  function createImpObj(id, w, h, bidfloor) {
    var obj = {};

    obj.id = id;
    obj.bidfloor = bidfloor;
    obj.video = {
      w,
      h,
      "pos": 1,
      "api": [1, 2],
      "protocols": [2, 3],
      "mimes": [
        "video/mp4"
      ],
      "linearity": 1
    }
    return obj;
  }

  /* Prebid executes this function when the page asks to send out bid requests */
  baseAdapter.callBids = function(bidRequest) {
    const bids = bidRequest.bids || [];
    var member = 0;
    let userObj;
    console.log(`callBids`, bids);
    const imps = bids
      .filter(bid => valid(bid))
      .map(bid => {
        // map request id to bid object to retrieve adUnit code in callback
        bidRequests[bid.bidId] = bid;

        openrtbBidRequest.id = bid.bidId;

        const params = bid.params;
        const dim = bid.sizes;

        openrtbBidRequest.site.id = params.partnerId;

        let imp = createImpObj(parseInt(params.placementId), dim[0], dim[1], params.bidFloor || 0);

        return imp;
      });

    if (!utils.isEmpty(imps)) {
      openrtbBidRequest.imp = imps;
      console.log(openrtbBidRequest)
      const payloadJson = openrtbBidRequest;
      if (member > 0) {
        payloadJson.member_id = member;
      }
      const payload = JSON.stringify(payloadJson);
      console.log(`payload`, payload);

      if (getParameterByName(`pbjs_debug`)) {
        ENDPOINT = 'http://localhost:5153/proxy';
      }

      console.log(ENDPOINT);
      ajax(ENDPOINT, handleResponse, payload, {
        contentType: 'application/json',
        // TODO update to true
        withCredentials : false
      });
    }
  };

  /* Notify Prebid of bid responses so bids can get in the auction */
  function handleResponse(response) {
    let parsed;
    console.log(`handleResponse`, response);
    console.log(`bidRequests`, bidRequests);

    try {
      parsed = JSON.parse(response);
    } catch (error) {
      utils.logError(error);
    }

    if (!parsed || parsed.error) {
      let errorMessage = `in response for ${baseAdapter.getBidderCode()} adapter`;
      if (parsed && parsed.error) {errorMessage += `: ${parsed.error}`;}
      utils.logError(errorMessage);

      // signal this response is complete
      Object.keys(bidRequests)
        .map(bidId => bidRequests[bidId].placementCode)
        .forEach(placementCode => {
          bidmanager.addBidResponse(placementCode, bidfactory.createBid(STATUS.NO_BID));
        });
      return;
    }

    utils._each(parsed.seatbid, function(seatbid) {
      utils._each(seatbid.bid, function(seatbidBid) {
        let bid = bidfactory.createBid(STATUS.GOOD);
        let nurl;

        if (seatbidBid.adm) {
          /*var blob = new Blob([decodeURIComponent(seatbidBid.adm)], {type : 'text/xml'});
          nurl = URL.createObjectURL(blob);*/
          nurl = `https://hollywoodwire.tv/vast.php?vast=` + encodeURIComponent(seatbidBid.adm);
          if (seatbidBid.nurl) {
            // fire win notification
            let winTrack = new Image();
            winTrack.src = seatbidBid.nurl;
          }
        } else {
          // nurl serves as win notice and should return vast response
          nurl = seatbidBid.nurl;
        }

        bid.code = baseAdapter.getBidderCode();
        bid.bidderCode = baseAdapter.getBidderCode();
        bid.cpm = seatbidBid.price;
        bid.vastUrl = nurl;
        bid.descriptionUrl = nurl;
        bid.creative_id = seatbidBid.crid;
        bid.width = seatbidBid.w;
        bid.height = seatbidBid.h;
        console.log(`addBidResponse`, bidRequests[parsed.id].placementCode, bid);
        bidmanager.addBidResponse(bidRequests[parsed.id].placementCode, bid);

        loadScript(ox + seatbidBid.id, function() {
          console.log('loaded ox script');
        });
      });
    });
  }

  /* Check that a bid has required paramters */
  function valid(bid) {
    if (bid.params.placementId || bid.params.member && bid.params.invCode) {
      return bid;
    } else {
      utils.logError('bid requires placementId or (member and invCode) params');
    }
  }

  return {
    createNew: MetaXchainAdapter.createNew,
    callBids: baseAdapter.callBids,
    setBidderCode: baseAdapter.setBidderCode,
  };

}

MetaXchainAdapter.createNew = function() {
  return new MetaXchainAdapter();
};

module.exports = MetaXchainAdapter;
