// Small stroke icon set, drawn on a 16px grid so every glyph matches.
const PATHS = {
  search: <><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></>,
  arrowRight: <path d="M3 8h10M9 4l4 4-4 4" />,
  arrowLeft: <path d="M13 8H3M7 4 3 8l4 4" />,
  external: <path d="M6 3H3v10h10v-3M9 3h4v4M13 3 7 9" />,
  close: <path d="m4 4 8 8M12 4l-8 8" />,
  upload: <path d="M8 11V3M4.5 6.5 8 3l3.5 3.5M3 13h10" />,
  file: <><path d="M4 2h5l3 3v9H4z" /><path d="M9 2v3h3" /></>,
  map: <path d="m1.5 4 4-1.5 5 1.5 4-1.5v9.5l-4 1.5-5-1.5-4 1.5z M5.5 2.5v9.5M10.5 4v9.5" />,
  ruler: <path d="M2 11 11 2l3 3-9 9zM5 8l1.5 1.5M7 6l1.5 1.5M9 4l1.5 1.5" />,
  calendar: <><rect x="2.5" y="3.5" width="11" height="10" rx="1" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" /></>,
  gauge: <path d="M2.5 11a5.5 5.5 0 1 1 11 0M8 11l3-3.5" />,
  check: <path d="m3 8.5 3 3 7-7" />,
  bolt: <path d="M9 1.5 3.5 9H8l-1 5.5L12.5 7H8z" />,
  road: <path d="M5 2 3 14M11 2l2 12M8 3v2M8 7.5v2M8 12v2" />,
  truck: <><path d="M1.5 4h8v7h-8zM9.5 6.5h3l2 2.5V11h-5z" /><circle cx="4.5" cy="12" r="1.3" /><circle cx="11.5" cy="12" r="1.3" /></>,
  users: <><circle cx="6" cy="5.5" r="2.3" /><path d="M1.8 13.5c.6-2.4 2.2-3.6 4.2-3.6s3.6 1.2 4.2 3.6M10.5 3.4a2.2 2.2 0 0 1 0 4.2M12 9.9c1.2.5 2 1.7 2.3 3.6" /></>,
  layers: <path d="m8 2 6 3-6 3-6-3zM2 8l6 3 6-3M2 11l6 3 6-3" />,
  home: <path d="M2.5 7.5 8 3l5.5 4.5V13a.5.5 0 0 1-.5.5H10v-4H6v4H3a.5.5 0 0 1-.5-.5z" />,
  link: <><circle cx="4.5" cy="8" r="2.5" /><circle cx="11.5" cy="8" r="2.5" /><path d="M7 8h2" /></>,
  chat: <path d="M2.5 3.5h11v7H8l-3 2.5v-2.5H2.5z M5.5 6.5h5M5.5 8.5h3" />,
  table: <><rect x="2" y="3" width="12" height="10" rx="1" /><path d="M2 6.5h12M2 9.8h12M6.5 6.5V13" /></>,
  pin: <><path d="M8 14s4.5-4.2 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 9.8 8 14 8 14z" /><circle cx="8" cy="6.5" r="1.6" /></>,
  line: <path d="M2 13 6 3l4 10 4-10" />,
  building: <path d="M3 14V3h6v11M9 6.5h4V14M2 14h12M5 5.5h2M5 8h2M5 10.5h2M11 9h0M11 11.5h0" />,
  download: <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" />,
  bulb: <path d="M6 12h4M6.5 14h3M5.2 9.6A4.3 4.3 0 1 1 10.8 9.6c-.5.5-.8 1-.8 1.9H6c0-.9-.3-1.4-.8-1.9z" />,
  alert: <path d="M8 2 14.5 13.5h-13zM8 6.5v3M8 11.5h0" />,
  list: <path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h0M2.5 8h0M2.5 12h0" />,
  crane: <path d="M3 14V3l10 2M3 5h7M11 4.6V8M10 8h2v2h-2zM1.5 14h5" />,
  refresh: <path d="M13 3v3.5H9.5M3 13V9.5h3.5M12.4 6.5A5 5 0 0 0 3.8 5M3.6 9.5a5 5 0 0 0 8.6 1.5" />,
  chart: <path d="M2.5 13.5h11M4.5 11V8M8 11V4.5M11.5 11V6.5" />,
  menu: <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />,
  phone: <path d="M5.5 2.5h-2a1 1 0 0 0-1 1.1 11 11 0 0 0 9.9 9.9 1 1 0 0 0 1.1-1v-2l-2.6-1-1.3 1.3a7.5 7.5 0 0 1-3.4-3.4L7.5 7.1 6.5 4.5z" />,
  mail: <><rect x="2" y="3.5" width="12" height="9" rx="1" /><path d="m2.5 4.5 5.5 4.5 5.5-4.5" /></>,
  shield: <path d="M8 1.8 13 3.8v4c0 3-2.2 5.3-5 6.4-2.8-1.1-5-3.4-5-6.4v-4z M5.8 8l1.6 1.6 3-3.2" />,
  target: <><circle cx="8" cy="8" r="5.5" /><circle cx="8" cy="8" r="2" /></>,
}

export default function Icon({ name, size = 16, className, ...rest }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} {...rest}>{PATHS[name]}</svg>
}

