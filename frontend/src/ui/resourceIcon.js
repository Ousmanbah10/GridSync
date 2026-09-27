// Icon for a shared-resource label coming from the backend.
export function resourceIcon(resource = '') {
  const text = resource.toLowerCase()
  if (/right|land|access|permit|road/.test(text)) return 'road'
  if (/crew|labor|people|staff|contractor/.test(text)) return 'users'
  if (/crane|heavy/.test(text)) return 'crane'
  if (/equipment|staging|yard|bay|laydown|deliver|logistic|material/.test(text)) return 'truck'
  if (/outage|substation|switch/.test(text)) return 'bolt'
  return 'layers'
}
