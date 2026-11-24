module.exports=[458152,a=>{a.v({className:"figtree_d9197d0f-module__6SbLOW__className",variable:"figtree_d9197d0f-module__6SbLOW__variable"})},947044,a=>{a.v({className:"schibsted_grotesk_8c873669-module__dppxzq__className",variable:"schibsted_grotesk_8c873669-module__dppxzq__variable"})},429735,a=>{"use strict";var b=a.i(907997),c=a.i(947044);let d={className:c.default.className,style:{fontFamily:"'Schibsted Grotesk', 'Schibsted Grotesk Fallback'",fontStyle:"normal"}};null!=c.default.variable&&(d.variable=c.default.variable);var e=a.i(458152);let f={className:e.default.className,style:{fontFamily:"'Figtree', 'Figtree Fallback'",fontStyle:"normal"}};null!=e.default.variable&&(f.variable=e.default.variable);var g=a.i(619114),h=a.i(685680),i=a.i(523688);let j="daybook:launched";Object.freeze(["light","dark"]);let k=`(function () {
  var root = document.documentElement;
  try {
    var theme = localStorage.getItem('${i.THEME_STORAGE_KEY}');
    if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  } catch (error) {}
  try {
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (navigator.webdriver || reduce || sessionStorage.getItem('${j}')) {
      root.setAttribute('data-launch', 'skip');
    } else {
      sessionStorage.setItem('${j}', '1');
    }
  } catch (error) {
    root.setAttribute('data-launch', 'skip');
  }
})();`;a.s(["default",0,function({children:a}){return(0,b.jsx)("html",{lang:"en",className:`${d.variable} ${f.variable}`,suppressHydrationWarning:!0,children:(0,b.jsxs)("body",{children:[(0,b.jsx)("script",{dangerouslySetInnerHTML:{__html:k}}),(0,b.jsx)(g.default,{}),a,(0,b.jsx)(h.default,{})]})})},"metadata",0,{title:{default:"Daybook",template:"%s · Daybook"},description:"Check in, log your day and submit your daily report.",applicationName:"Daybook",icons:{icon:[{url:"/icons/icon.svg",type:"image/svg+xml"},{url:"/favicon.ico"}],apple:"/icons/icon-192.png"}},"viewport",0,{width:"device-width",initialScale:1,themeColor:"#151833"}],429735)},881967,function(a){a.n(a.i(429735))},983605,a=>{"use strict";a.s(["default",()=>b]);let b=(0,a.i(211857).registerClientReference)(function(){throw Error("Attempted to call the default export of [project]/src/components/LaunchSplash.jsx from the server, but it's on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.")},"[project]/src/components/LaunchSplash.jsx","default")},619114,a=>{"use strict";var b=a.i(983605);a.n(b)},71313,a=>{"use strict";a.s(["default",()=>b]);let b=(0,a.i(211857).registerClientReference)(function(){throw Error("Attempted to call the default export of [project]/src/components/ServiceWorker.jsx from the server, but it's on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.")},"[project]/src/components/ServiceWorker.jsx","default")},685680,a=>{"use strict";var b=a.i(71313);a.n(b)},523688,a=>{"use strict";let b=Object.freeze(["system","light","dark"]);a.s(["THEMES",0,b,"THEME_STORAGE_KEY",0,"daybook-theme"])}];

//# sourceMappingURL=%5Broot-of-the-server%5D__0_dhr03._.js.map