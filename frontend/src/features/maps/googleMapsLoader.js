// Load once per browser page; React remounts reuse the same SDK request.
let sdkPromise

export function loadGoogleMaps(apiKey) {
  if (!apiKey) return Promise.reject(new Error('A Google Maps browser API key is required.'))
  if (window.google?.maps?.Map) return Promise.resolve(window.google.maps)
  if (sdkPromise) return sdkPromise
  sdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    const callback = '__gridSyncMapsReady'
    const timeout = window.setTimeout(() => fail('Google Maps timed out. Check your connection and reload.'), 30000)
    function fail(message) {
      window.clearTimeout(timeout)
      // Keep the callback harmless if a delayed script eventually arrives.
      window[callback] = () => {}
      script.remove()
      reject(new Error(message))
    }
    window[callback] = () => {
      window.clearTimeout(timeout)
      delete window[callback]
      resolve(window.google.maps)
    }
    script.src = `https://maps.googleapis.com/maps/api/js?${new URLSearchParams({
      key: apiKey, loading: 'async', callback, v: 'quarterly',
    })}`
    script.async = true
    script.onerror = () => fail('Google Maps could not load. Check your connection and browser restrictions.')
    document.head.appendChild(script)
  })
  return sdkPromise
}
