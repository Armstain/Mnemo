// The pin map: a small Leaflet page, shown in a WebView on phones and an
// iframe on the web. OpenStreetMap tiles, so no map key is needed; tiles
// (and Leaflet itself) load only while this screen is open, and nothing
// about the pin is sent anywhere: the page reports where the map is
// centred back to the app, and draws the circles the app gives it.
//
// For a wide release, point TILE_URL at a provider with a key (MapTiler,
// Stadia): OpenStreetMap's own servers are for light use.

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = '© OpenStreetMap contributors';

/** Messages the app sends the page. */
export type ToMap =
  | { type: 'radius'; radius: number }
  | { type: 'goto'; lat: number; lng: number; zoom?: number }
  | { type: 'others'; places: { name: string; lat: number; lng: number; radius: number }[] };

/** Messages the page sends the app. `byUser`: the person moved the map (not a "go to"). */
export type FromMap = { type: 'ready' } | { type: 'offline' } | { type: 'center'; lat: number; lng: number; zoom: number; byUser: boolean };

export function mapHtml(o: { lat: number; lng: number; zoom: number; radius: number; accent: string; other: string; bg: string }): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>
html,body,#m{margin:0;height:100%;background:${o.bg}}
.lbl{background:transparent;border:0;box-shadow:none;font:600 12px system-ui,sans-serif;color:${o.other}}
.lbl:before{display:none}
.far .lbl{display:none}
.leaflet-control-attribution{font-size:10px}
</style></head><body><div id="m"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
function send(m){var s=JSON.stringify(m);if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(s);else parent.postMessage(s,'*');}
if(!window.L){send({type:'offline'});}else{
var map=L.map('m',{zoomControl:false}).setView([${o.lat},${o.lng}],${o.zoom});
var loaded=0,errors=0;
L.tileLayer('${TILE_URL}',{maxZoom:19,attribution:'${TILE_ATTRIBUTION}'})
 .on('tileload',function(){loaded++;})
 .on('tileerror',function(){errors++;if(errors>3&&!loaded)send({type:'offline'});})
 .addTo(map);
var mine=L.circle(map.getCenter(),{radius:${o.radius},color:'${o.accent}',weight:2,fillColor:'${o.accent}',fillOpacity:0.14}).addTo(map);
var others=L.layerGroup().addTo(map);
function labels(){map.getContainer().classList.toggle('far',map.getZoom()<14);}
map.on('zoomend',labels);labels();
var programmatic=false;
map.on('move',function(){mine.setLatLng(map.getCenter());});
map.on('moveend',function(){var c=map.getCenter();send({type:'center',lat:c.lat,lng:c.lng,zoom:map.getZoom(),byUser:!programmatic});programmatic=false;});
function handle(m){
 if(m.type==='radius')mine.setRadius(m.radius);
 if(m.type==='goto'){programmatic=true;map.setView([m.lat,m.lng],m.zoom||map.getZoom());}
 if(m.type==='others'){others.clearLayers();m.places.forEach(function(p){
  L.circle([p.lat,p.lng],{radius:p.radius,color:'${o.other}',weight:1.5,dashArray:'5 5',fillColor:'${o.other}',fillOpacity:0.08,interactive:false}).addTo(others);
  L.tooltip({permanent:true,direction:'center',className:'lbl'}).setLatLng([p.lat,p.lng]).setContent(p.name).addTo(others);});}
}
function onMsg(e){try{handle(typeof e.data==='string'?JSON.parse(e.data):e.data);}catch(x){}}
window.addEventListener('message',onMsg);document.addEventListener('message',onMsg);
send({type:'ready'});
}
</script></body></html>`;
}
