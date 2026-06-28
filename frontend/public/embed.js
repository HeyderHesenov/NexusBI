/* NexusBI embed SDK — auto-mounts read-only dashboard iframes.
 * Usage:
 *   <div data-nexusbi-embed="EMBED_TOKEN" data-height="600"></div>
 *   <script src="https://your-host/embed.js"></script>
 */
(function () {
  var origin = (function () {
    try {
      return new URL(document.currentScript.src).origin
    } catch (e) {
      return window.location.origin
    }
  })()

  function mount(el) {
    if (el.getAttribute('data-nexusbi-mounted')) return
    var token = el.getAttribute('data-nexusbi-embed')
    if (!token) return
    var height = el.getAttribute('data-height') || '600'
    var iframe = document.createElement('iframe')
    iframe.src = origin + '/embed/' + encodeURIComponent(token)
    iframe.width = '100%'
    iframe.height = height
    iframe.style.border = '0'
    iframe.setAttribute('loading', 'lazy')
    iframe.setAttribute('title', 'NexusBI dashboard')
    el.appendChild(iframe)
    el.setAttribute('data-nexusbi-mounted', '1')
  }

  function mountAll() {
    var nodes = document.querySelectorAll('[data-nexusbi-embed]')
    for (var i = 0; i < nodes.length; i++) mount(nodes[i])
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountAll)
  } else {
    mountAll()
  }
})()
