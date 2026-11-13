// ---------- basics ----------
var $ = function (id) { return document.getElementById(id); };
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// Days of the week, Monday first. Index is JS getUTCDay() (0 = Sunday).
var DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];
var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
var DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
var NO_OFF = 32767;

// Icons: 24×24 filled paths.
var ICONS = {
  pin: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z',
  chart: 'M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z',
  history: 'M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z',
  filter: 'M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z',
  layers: 'M11.99 18.54l-7.37-5.73L3 14.07l9 7 9-7-1.63-1.27-7.38 5.74zM12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27L12 16z',
  gear: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
  expand: 'M21 11V3h-8l3.29 3.29-10 10L3 13v8h8l-3.29-3.29 10-10z',
  close: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  left: 'M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z',
  down: 'M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z',
  folder: 'M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z',
  right: 'M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z',
  play: 'M8 5v14l11-7z',
  playCircle: 'M10 16.5l6-4.5-6-4.5v9zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z',
  pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
  calendar: 'M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zM9 14H7v-2h2v2zm4 0h-2v-2h2v2zm4 0h-2v-2h2v2zm-8 4H7v-2h2v2zm4 0h-2v-2h2v2zm4 0h-2v-2h2v2z',
  fit: 'M3 5v4h2V5h4V3H5c-1.1 0-2 .9-2 2zm2 10H3v4c0 1.1.9 2 2 2h4v-2H5v-4zm14 4h-4v2h4c1.1 0 2-.9 2-2v-4h-2v4zm0-16h-4v2h4v4h2V5c0-1.1-.9-2-2-2z',
  upload: 'M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z',
  logo: 'M23 8c0 1.1-.9 2-2 2a1.7 1.7 0 0 1-.51-.07l-3.56 3.55c.05.16.07.34.07.52 0 1.1-.9 2-2 2s-2-.9-2-2c0-.18.02-.36.07-.52l-2.55-2.55c-.16.05-.34.07-.52.07s-.36-.02-.52-.07l-4.55 4.56c.05.16.07.33.07.51 0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2c.18 0 .35.02.51.07l4.56-4.55C8.02 9.36 8 9.18 8 9c0-1.1.9-2 2-2s2 .9 2 2c0 .18-.02.36-.07.52l2.55 2.55c.16-.05.34-.07.52-.07s.36.02.52.07l3.55-3.56A1.7 1.7 0 0 1 19 8c0-1.1.9-2 2-2s2 .9 2 2z',
  home: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
  bolt: 'M7 2v11h3v9l7-12h-4l4-8z',
  ruler: 'M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 10H3V8h2v4h2V8h2v4h2V8h2v4h2V8h2v4h2V8h2v8z',
  info: 'M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z',
  shield: 'M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z',
  left2:'M17.59 18L19 16.59 14.42 12 19 7.41 17.59 6l-6 6zM11 18l1.41-1.41L7.83 12l4.58-4.59L11 6l-6 6z',
  right2: 'M6.41 6L5 7.41 9.58 12 5 16.59 6.41 18l6-6zM13 6l-1.41 1.41L16.17 12l-4.58 4.59L13 18l6-6z',
  clock: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z',
  // Transport
  WALKING: 'M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7',
  RUNNING: 'M13.49 5.48c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm-3.6 13.9l1-4.4 2.1 2v6h2v-7.5l-2.1-2 .6-3c1.3 1.5 3.3 2.5 5.5 2.5v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1l-5.2 2.2v4.7h2v-3.4l1.8-.7-1.6 8.1-4.9-1-.4 2 7 1.4z',
  CYCLING: 'M15.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM5 12c-2.8 0-5 2.2-5 5s2.2 5 5 5 5-2.2 5-5-2.2-5-5-5zm0 8.5c-1.9 0-3.5-1.6-3.5-3.5s1.6-3.5 3.5-3.5 3.5 1.6 3.5 3.5-1.6 3.5-3.5 3.5zm5.8-10l2.4-2.4.8.8c1.3 1.3 3 2.1 5.1 2.1V9c-1.5 0-2.7-.6-3.6-1.5l-1.9-1.9c-.5-.4-1-.6-1.6-.6s-1.1.2-1.4.6L7.8 8.4c-.4.4-.6.9-.6 1.4 0 .6.2 1.1.6 1.4L11 14v5h2v-6.2l-2.2-2.3zM19 12c-2.8 0-5 2.2-5 5s2.2 5 5 5 5-2.2 5-5-2.2-5-5-5zm0 8.5c-1.9 0-3.5-1.6-3.5-3.5s1.6-3.5 3.5-3.5 3.5 1.6 3.5 3.5-1.6 3.5-3.5 3.5z',
  CAR: 'M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z',
  TAXI: 'M18.92 6.01C18.72 5.42 18.16 5 17.5 5H15V3H9v2H6.5c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z',
  MOTORCYCLE: 'M5 13a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm14-2a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM8 12h5l2-4h3v2h-2l-1.6 3.2L16 16h-2.3l-1.5-2H8.6z',
  BUS: 'M4 16c0 .88.39 1.67 1 2.22V20c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h8v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4v10zm3.5 1c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1.5-6H6V6h12v5z',
  TRAIN: 'M12 2c-4 0-8 .5-8 4v9.5C4 17.43 5.57 19 7.5 19L6 20.5v.5h2.23l2-2H14l2 2h2v-.5L16.5 19c1.93 0 3.5-1.57 3.5-3.5V6c0-3.5-3.58-4-8-4zM7.5 17c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm3.5-7H6V6h5v4zm2 0V6h5v4h-5zm3.5 7c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z',
  TRAM: 'M19 16.94V8.5c0-2.79-2.61-3.4-6.01-3.49l.76-1.51H17V2H7v1.5h4.75l-.76 1.52C7.86 5.11 5 5.73 5 8.5v8.44c0 1.45 1.19 2.66 2.59 2.97L6 21.5v.5h2.23l2-2H14l2 2h2v-.5L16.5 20h-.08c1.69 0 2.58-1.37 2.58-3.06zm-7 1.56c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm5-4.5H7V9h10v5z',
  SUBWAY: 'M12 2c-4.42 0-8 .5-8 4v9.5C4 17.43 5.57 19 7.5 19L6 20.5v.5h12v-.5L16.5 19c1.93 0 3.5-1.57 3.5-3.5V6c0-3.5-3.58-4-8-4zM7.5 17c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm3.5-6H6V6h5v5zm5.5 6c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1.5-6h-5V6h5v5z',
  CABLE: 'M3 3l18 3v2l-8-1.3V9h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h3V6.4L3 5zM8 11v4h3v-4zm5 0v4h3v-4z',
  FERRY: 'M20 21c-1.39 0-2.78-.47-4-1.32-2.44 1.71-5.56 1.71-8 0C6.78 20.53 5.39 21 4 21H2v2h2c1.38 0 2.74-.35 4-.99 2.52 1.29 5.48 1.29 8 0 1.26.65 2.62.99 4 .99h2v-2h-2zM3.95 19H4c1.6 0 3.02-.88 4-2 .98 1.12 2.4 2 4 2s3.02-.88 4-2c.98 1.12 2.4 2 4 2h.05l1.89-6.68c.08-.26.06-.54-.06-.78s-.34-.42-.6-.5L20 10.62V6c0-1.1-.9-2-2-2h-3V1H9v3H6c-1.1 0-2 .9-2 2v4.62l-1.29.42c-.26.08-.48.26-.6.5s-.15.52-.06.78L3.95 19zM6 6h12v3.97L12 8 6 9.97V6z',
  BOAT: 'M11 13.5V2L3 13.5h8zm10 0C21 6.5 14.5 1 12.5 1c0 0 1 3 1 6.5s-1 6-1 6H21zm1 1.5H2c.31 1.53 1.16 2.84 2.33 3.73.65-.27 1.22-.69 1.67-1.23.73.88 1.84 1.5 3 1.5s2.27-.62 3-1.5c.73.88 1.84 1.5 3 1.5s2.27-.62 3-1.5c.45.54 1.02.96 1.67 1.23 1.17-.89 2.02-2.2 2.33-3.73z',
  FLYING: 'M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z',
  SKIING: 'M14 6l-3.75 5 2.85 3.8-1.6 1.2C9.81 13.75 7 10 7 10l-6 8h22L14 6z',
  OTHER: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z',
  // How far is that?
  caravel: 'M11 1.5l3.2 1.1L11 3.7zM10.3 1.5h.9V4c1.4.3 2.8.3 4.3-.1v7.7c-1.5.4-2.9.4-4.3.1V15h-.9v-3.4C9 11.3 7.9 10.8 7 10.3V4.6c1 .5 2.1.9 3.3 1.1zM16.3 5.4c1.2.3 2.4.3 3.7-.1v6c-1.3.4-2.5.4-3.7.1zM6.1 4.2V15h-.8v-1.4H2.4zM1.5 15.8h21l-2.6 4.6c-.3.5-.8.8-1.4.8H5.6c-.6 0-1.1-.3-1.4-.8z',
  capsule: 'M1 8.6l2.6.9V14.5L1 15.4zM4.3 7h7.4v10H4.3zM12.6 6.6l7.6 3.6c1.3.6 1.3 3 0 3.6l-7.6 3.6zM15.6 10a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2z',
  earth: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z',
  moon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9 6.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6 4.5a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm-6.5 5a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4z',
  camel: 'M2.6 11.2c.6-.3 1.2-.1 1.5.4l.7 1.3c.4-2.3 1.9-4.4 3.6-4.4 1.3 0 2 1 2.6 2.2.5-1.7 1.6-3 3-3 1.6 0 2.6 1.7 3 3.6.3 1.1.9 1.5 1.6 1.2l.8-3.5c-.4-.3-.7-.8-.6-1.3.1-.9.9-1.5 1.8-1.4l1.5.2v1.3l-1.2.2-1 5c-.3 1.4-1.2 2.4-2.4 2.7V21h-1.5v-5.4h-1.7V21h-1.5v-5.2H9.7V21H8.2v-5.3H6.6V21H5.1v-6.3c-.6-.5-1-1.2-1.2-2l-.7-.9c-.3.3-.6.4-.8.1-.2-.3 0-.6.2-.7z',
  rocket: 'M5 9.4h9.5c3.2 0 6.4 1.1 8.5 2.6-2.1 1.5-5.3 2.6-8.5 2.6H5zM15.5 10.8a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4zM5 9.4L2.2 6.5h4.3l2.6 2.9zM5 14.6l-2.8 2.9h4.3l2.6-2.9zM1 10.5h3.2v3H1z',
  mars: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8.2 4.6c2.3-.9 5.3-.9 7.6 0C14.6 5.5 13.4 6 12 6s-2.6-.5-3.8-1.4zM4.4 12.4c2.6-.6 5-.2 7.2 1 2.4 1.3 5.1 1.6 8 .6-.2.8-.5 1.5-.9 2.2-2.6.6-5.1.2-7.6-1.1-2-1.1-4.2-1.4-6.4-.9-.2-.6-.3-1.2-.3-1.8zM15 8.4a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8z',
  voyager: 'M1.5 4.5c4.6.4 7 3.7 7 7.5s-2.4 7.1-7 7.5c1.5-2 2.3-4.6 2.3-7.5S3 6.5 1.5 4.5zM9.3 9.6h4.2v4.8H9.3zM13.5 11.4h9.3v1.2h-9.3zM10.6 14.4h1.2l-2.3 5.4H8.3zM8.4 11.4h1v1.2h-1zM12 9.6l1.8-4h1.2l-1.8 4z',
  flag: 'M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z',
  zoomOut: 'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14zM7 9h5v1H7z',
  zoomIn: 'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14zm2.5-4h-2v2H9v-2H7V9h2V7h1v2h2v1z',
  UNKNOWN: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z'
};
ICONS.VEHICLE = ICONS.CAR;
// Gear icons drawn with lines rather than one filled path: the halfbike (a standing bike with a big
// front wheel, two small ones at the back and a curved frame up to the handlebar) and a front-loading
// cargo bike (the rider of the cycling icon behind a box over a small front wheel).
var LINE_ICONS = {
  // Mirrored so it rides to the right like the other bikes.
  halfbike: '<g transform="matrix(-1 0 0 1 24 0)"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="7.27" cy="17.61" r="4.07"/><circle cx="19.04" cy="20.03" r="1.76"/>' +
    '<path d="M8.59 3.31C8.59 3.31 3.29 14.33 6.37 16.64C9.43 18.97 12.86 15.01 17.72 19.37"/></g><circle cx="12.33" cy="17.28" r="1.5"/><circle cx="8.81" cy="2.98" r="1.35"/></g>',
  cargobike: '<path transform="translate(-0.6 2.6) scale(.84)" d="CARGO_RIDER"/><g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M13 12.2h8.6l-1.2 3.4a2 2 0 0 1-1.9 1.4H13z" fill="currentColor"/><circle cx="19.8" cy="20.4" r="1.8"/><path d="M9.4 19.4h8.4"/></g>'
};
LINE_ICONS.cargobike = LINE_ICONS.cargobike.replace('CARGO_RIDER', ICONS.CYCLING.slice(0, ICONS.CYCLING.indexOf('M19 12')));
function icon(name, cls) {
  var open = '<svg class="ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true"';
  if (LINE_ICONS[name]) return open + '>' + LINE_ICONS[name] + '</svg>';
  var d = ICONS[name] || ICONS.OTHER;
  return open + (name === 'CABLE' || name === 'capsule' || name === 'moon' || name === 'rocket' || name === 'mars' ? ' fill-rule="evenodd"' : '') + '><path d="' + d + '"/></svg>';
}
function fillIcons(root) {
  (root || document).querySelectorAll('[data-icon]').forEach(function (el) {
    el.outerHTML = icon(el.getAttribute('data-icon'));
  });
}

// ---------- transport modes ----------
var LABEL = { WALKING: 'Walking', RUNNING: 'Running', CYCLING: 'Cycling', CAR: 'Car', MOTORCYCLE: 'Motorbike', BUS: 'Bus',
  TRAIN: 'Train', VEHICLE: 'Vehicle', TAXI: 'Taxi', OTHER: 'Other', TRAM: 'Tram', SUBWAY: 'Metro', FERRY: 'Ferry', BOAT: 'Boat', FLYING: 'Flight', SKIING: 'Snow sports',
  CABLE: 'Cable car', UNKNOWN: 'Unclassified' };
// Colour groups, in the fixed order of the categorical palette.
var GROUPS = [
  { key: 'road', label: 'Road', v: '--m-road', modes: ['CAR', 'TAXI', 'VEHICLE', 'MOTORCYCLE'] },
  { key: 'air', label: 'Flights', v: '--m-air', modes: ['FLYING'] },
  { key: 'transit', label: 'Public transport', v: '--m-transit', modes: ['BUS', 'TRAIN', 'TRAM', 'SUBWAY', 'CABLE'] },
  { key: 'foot', label: 'On foot', v: '--m-foot', modes: ['WALKING', 'RUNNING'] },
  { key: 'bike', label: 'Cycling', v: '--m-bike', modes: ['CYCLING'] },
  { key: 'water', label: 'Water', v: '--m-water', modes: ['FERRY', 'BOAT'] },
  { key: 'other', label: 'Other', v: '--m-other', modes: ['SKIING', 'OTHER', 'UNKNOWN'] }
];
var GROUP_OF = {};
GROUPS.forEach(function (g) { g.color = 'var(' + g.v + ')'; g.modes.forEach(function (m) { GROUP_OF[m] = g; }); });
function groupOf(m) { return GROUP_OF[m] || GROUPS[GROUPS.length - 1]; }
function modeColor(m) { return groupOf(m).color; }
function modeOf(i) { return MODES[D.mode[i]]; }
// A trip's name: its Strava sport (Kayaking, Mountain bike…) when it has one, else its mode.
function tripLabel(i) { var s = D.sport && D.sport[i]; if (s && SPORTS[s]) return SPORTS[s][1]; if (D.stype && D.stype[i]) return esc(D.stype[i]); var m = modeOf(i); return LABEL[m] || m; }
// strava adds Strava's mark in the top right corner.
var STRAVA_MARK = '<span class="strava-mark" title="From Strava"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.6 1.5 11 10H8.4L6.6 6.6 4.8 10H2.2zM10.3 10.6l1.2 2.4 1.2-2.4h1.9l-3.1 6-3.1-6z" fill="#fff"/></svg></span>';
// Trips from a simulated file (see merge) get a "Simulated" tag wherever they are shown.
function isSim(i) { return !!(D.srcs && D.srcs[i] === SRC.sim); }
function simTag(i) { return isSim(i) ? '<span class="guess sim">Simulated</span>' : ''; }
function badge(m, small, strava, ic) { return '<span class="mode-badge' + (small ? ' sm' : '') + '" style="background:' + modeColor(m) + '">' + icon(ic || m) + (strava ? STRAVA_MARK : '') + '</span>'; }
// A ride on a cargo bike or a Halfbike shows that bike's icon.
function tripIcon(i) { var g = D.gear ? D.gear[i] : 0; return g && (GEAR[g].kind === 'halfbike' || GEAR[g].kind === 'cargo') ? gearIcon(g) : modeOf(i); }

// ---------- preferences ----------
var PREFS_KEY = 'btdt.prefs';
var PREFS = {
  unit: 'km', theme: 'system', proj: 'merc', paths: true, speedPaths: false, squares: false, heat: false, cc: false, pins: false, placeScope: 'all', spotMerge: {},
  heatSrc: 'moves', heatBy: 'time', heatSize: 14, heatGain: 50, splitM: 'km', timeM: 'km', timeU: 'year', speed: 1,
  // The time slider starts hidden on phones.
  scrub: !window.matchMedia('(pointer: coarse)').matches && window.matchMedia('(min-width: 960px)').matches
};
try { Object.assign(PREFS, JSON.parse(localStorage.getItem(PREFS_KEY) || localStorage.getItem('timeliner.prefs') || '{}')); } catch (e) { /* storage unavailable */ }
// The demo turns Countries visited on for itself; your own setting is what gets saved.
function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(DEMO ? Object.assign({}, PREFS, { cc: DEMO.cc }) : PREFS)); } catch (e) { /* ignore */ } }
function applyTheme() {
  if (PREFS.theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', PREFS.theme);
  var meta = document.querySelector('meta[name="theme-color"]:not([media])');
  if (meta) meta.setAttribute('content', cssVar('--bg'));
}
function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function isDark() { return cssVar('color-scheme') === 'dark'; }

// ---------- CO₂ (UK DESNZ/DEFRA 2025 factors, g CO₂e per km) ----------
var CAR = { petrol: 163, diesel: 173, hybrid: 128, ev: 47 };
var DEFAULTS = {
  car: 'petrol', occ: 1, rf: true,
  g: { CAR: 163, VEHICLE: 163, TAXI: 149, MOTORCYCLE: 114, BUS: 104, TRAIN: 35, TRAM: 29, SUBWAY: 28, FERRY: 19, CABLE: 0, BOAT: 0,
    WALKING: 0, RUNNING: 0, CYCLING: 0, SKIING: 0, OTHER: 0 },
  // Flights by distance band: with / without the extra warming at altitude.
  fly: { dom: [229, 136], short: [126, 74], long: [117, 69] }
};
var EDIT = ['VEHICLE', 'TAXI', 'MOTORCYCLE', 'BUS', 'TRAIN', 'TRAM', 'SUBWAY', 'FERRY', 'CABLE', 'BOAT'];
var A = loadFactors();
function loadFactors() {
  var a = JSON.parse(JSON.stringify(DEFAULTS));
  try {
    var s = JSON.parse(localStorage.getItem('btdt.co2') || localStorage.getItem('timeliner.co2') || localStorage.getItem('footprint.assumptions') || 'null');
    if (s && s.g) { a.car = s.car || a.car; a.occ = s.occ || 1; a.rf = s.rf !== false; Object.keys(s.g).forEach(function (k) { if (isFinite(s.g[k])) a.g[k] = s.g[k]; }); }
  } catch (e) { /* storage unavailable */ }
  return a;
}
function saveFactors() { try { localStorage.setItem('btdt.co2', JSON.stringify({ car: A.car, occ: A.occ, rf: A.rf, g: A.g })); } catch (e) { /* ignore */ } }
function gPerKm(m, kmv) {
  if (m === 'FLYING') { var band = kmv < 500 ? 'dom' : kmv < 3700 ? 'short' : 'long'; return A.fly[band][A.rf ? 0 : 1]; }
  if (m === 'CAR' || m === 'MOTORCYCLE') return (A.g[m] || 0) / Math.max(1, A.occ);
  return A.g[m] || 0;
}
function tripKg(i) { var m = modeOf(i); return D.km[i] * gPerKm(m, D.km[i]) / 1000; }

// ---------- formatting ----------
var MI = 0.621371;
function fmt(n, d) { return n.toLocaleString('en-US', { maximumFractionDigits: d || 0, minimumFractionDigits: d || 0 }); }
function distVal(kmv) { return PREFS.unit === 'mi' ? kmv * MI : kmv; }
function distUnit() { return PREFS.unit === 'mi' ? 'mi' : 'km'; }
function dist(kmv) { var v = distVal(kmv); return fmt(v, v < 10 && v > 0 ? 1 : 0) + ' ' + distUnit(); }
function distParts(kmv) { var v = distVal(kmv); return { v: fmt(v, v < 10 && v > 0 ? 1 : 0), u: distUnit() }; }
function speed(kmh) { return fmt(distVal(kmh)) + (PREFS.unit === 'mi' ? ' mph' : ' km/h'); }
function co2(kg) {
  if (kg >= 1000) return { v: fmt(kg / 1000, kg >= 100000 ? 0 : 1), u: 't' };
  return { v: kg === 0 ? '0' : fmt(kg, kg < 10 ? 1 : 0), u: 'kg' };
}
function co2s(kg) { var c = co2(kg); return c.v + ' ' + c.u; }
function hoursLabel(h) { var m = Math.round(h * 60); return !m ? '0 min' : m < 60 ? m + ' min' : fmt(Math.floor(m / 60)) + ' h' + (m % 60 && m < 6000 ? ' ' + (m % 60) + ' min' : ''); }
function duration(ms) {
  var min = Math.round(ms / 60000);
  if (min < 60) return min + ' min';
  var h = Math.floor(min / 60), m = min % 60;
  if (h < 48) return h + ' h' + (m ? ' ' + m + ' min' : '');
  return Math.floor(h / 24) + ' days ' + (h % 24) + ' h';
}
function dayToDate(d) { return new Date(d * 864e5); }
function isoDay(d) { return dayToDate(d).toISOString().slice(0, 10); }
function parseIsoDay(s) { if (!s) return null; var t = Date.parse(s + 'T00:00:00Z'); return isFinite(t) ? Math.floor(t / 864e5) : null; }
function niceDate(d) { var x = dayToDate(d); return x.getUTCDate() + ' ' + MONTHS[x.getUTCMonth()] + ' ' + x.getUTCFullYear(); }
// Periods for stepping through the data: the day, Monday-to-Sunday week, month or year holding day d.
function periodStart(d, u) {
  if (u === 'week') return d - (((d + 3) % 7) + 7) % 7;
  if (u === 'day') return d;
  var x = dayToDate(d);
  return Math.floor(Date.UTC(x.getUTCFullYear(), u === 'month' ? x.getUTCMonth() : 0, 1) / 864e5);
}
function periodEnd(d, u) {
  if (u === 'day') return d;
  if (u === 'week') return periodStart(d, u) + 6;
  var x = dayToDate(d), y = x.getUTCFullYear();
  return Math.floor((u === 'month' ? Date.UTC(y, x.getUTCMonth() + 1, 1) : Date.UTC(y + 1, 0, 1)) / 864e5) - 1;
}
function periodLabel(d, u) {
  var a = dayToDate(periodStart(d, u)), z = dayToDate(periodEnd(d, u));
  if (u === 'year') return '' + a.getUTCFullYear();
  if (u === 'month') return MONTHS_LONG[a.getUTCMonth()] + ' ' + a.getUTCFullYear();
  if (u === 'week') {
    var sameY = a.getUTCFullYear() === z.getUTCFullYear(), sameM = sameY && a.getUTCMonth() === z.getUTCMonth();
    return a.getUTCDate() + (sameM ? '' : ' ' + MONTHS[a.getUTCMonth()]) + (sameY ? '' : ' ' + a.getUTCFullYear()) + ' – ' + niceDate(periodEnd(d, u));
  }
  return niceDate(d);
}
function longDate(d) { var x = dayToDate(d); return DOW_LONG[x.getUTCDay()] + ', ' + x.getUTCDate() + ' ' + MONTHS_LONG[x.getUTCMonth()] + ' ' + x.getUTCFullYear(); }
function pad2(n) { return (n < 10 ? '0' : '') + n; }
// Clock time where the trip happened when the file says the UTC offset, else in this browser's time zone.
function clock(ms, off, withDate) {
  var known = off != null && off !== NO_OFF, d = new Date(known ? ms + off * 60000 : ms);
  var g = function (k) { return d[(known ? 'getUTC' : 'get') + k](); };
  var t = pad2(g('Hours')) + ':' + pad2(g('Minutes'));
  if (withDate) t = g('Date') + ' ' + MONTHS[g('Month')] + ' ' + g('FullYear') + ', ' + t;
  return t;
}
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function ll(a, b) { return isFinite(a) ? a.toFixed(3) + ', ' + b.toFixed(3) : '?'; }
function haversine(a, b) {
  if (!a || !b || !isFinite(a[0]) || !isFinite(b[0])) return NaN;
  var R = 6371.0088, r = Math.PI / 180, dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r;
  var h = Math.pow(Math.sin(dLa / 2), 2) + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.pow(Math.sin(dLo / 2), 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
function toast(text) {
  var t = $('toast'); t.textContent = text; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, 3500);
}
function busy(text) { $('busy').hidden = !text; $('busy').textContent = text || ''; }

// ---------- countries ----------
var CB = null;
function decodeCountries() {
  CB = { grid: {}, rings: {} };
  COUNTRIES.split(';').forEach(function (part) {
    var c = part.indexOf(':'), cc = part.slice(0, c);
    part.slice(c + 1).split('!').forEach(function (str) {
      var nums = [], z = 0, sh = 0;
      for (var i = 0; i < str.length; i++) {
        var v = str.charCodeAt(i) - 63;
        z |= (v & 31) << sh;
        if (v & 32) { sh += 5; continue; }
        nums.push(z & 1 ? -((z + 1) / 2) : z / 2); z = 0; sh = 0;
      }
      var ring = new Float32Array(nums.length), x = 0, y = 0, minX = 999, minY = 999, maxX = -999, maxY = -999;
      for (var j = 0; j < nums.length; j += 2) {
        x += nums[j]; y += nums[j + 1];
        var lx = x / 200, ly = y / 200;
        ring[j] = lx; ring[j + 1] = ly;
        if (lx < minX) minX = lx; if (lx > maxX) maxX = lx; if (ly < minY) minY = ly; if (ly > maxY) maxY = ly;
      }
      (CB.rings[cc] || (CB.rings[cc] = [])).push(ring);
      // Index each ring by the 5° cells its bounding box covers.
      for (var gx = Math.floor(minX / 5); gx <= Math.floor(maxX / 5); gx++)
        for (var gy = Math.floor(minY / 5); gy <= Math.floor(maxY / 5); gy++) {
          var key = gx + ',' + gy;
          (CB.grid[key] || (CB.grid[key] = [])).push({ cc: cc, ring: ring, minX: minX, minY: minY, maxX: maxX, maxY: maxY });
        }
    });
  });
}
// Places the simplified borders leave out or give to a neighbour, outlined by hand (lat, lng
// pairs, about 300 m off at most): Gibraltar, the Vatican, and Spain's Ceuta and Melilla.
var SMALL_PLACES = {
  ES: [35.915, -5.382, 35.902, -5.338, 35.915, -5.300, 35.905, -5.272, 35.888, -5.276, 35.877, -5.303, 35.871, -5.345, 35.880, -5.371],
  'ES ': [35.317, -2.955, 35.306, -2.926, 35.290, -2.924, 35.270, -2.943, 35.274, -2.966, 35.290, -2.973, 35.306, -2.969],
  GI: [36.1555, -5.3665, 36.1555, -5.3385, 36.142, -5.3375, 36.125, -5.3355, 36.109, -5.3445, 36.114, -5.353, 36.130, -5.358, 36.140, -5.364, 36.148, -5.368],
  VA: [41.9075, 12.4460, 41.9075, 12.4580, 41.9000, 12.4590, 41.9000, 12.4455]
};
function inPolygon(lat, lng, P) {
  for (var i = 0, j = P.length - 2, hit = false; i < P.length; j = i, i += 2)
    if ((P[i] > lat) !== (P[j] > lat) && lng < (P[j + 1] - P[i + 1]) * (lat - P[i]) / (P[j] - P[i]) + P[i + 1]) hit = !hit;
  return hit;
}
function countryAt(lat, lng) {
  if (!isFinite(lat)) return '';
  if (!CB) decodeCountries();
  for (var sp in SMALL_PLACES) if (inPolygon(lat, lng, SMALL_PLACES[sp])) return sp.trim();
  var p = polyCountry(lat, lng), ap;
  if (p) {
    // Overseas parts the borders file folds into their country (Réunion, Guadeloupe and French
    // Guiana into France, Bonaire into the Netherlands): they keep their own code.
    var t = territoryAt(lat, lng, p);
    if (t) return t;
    // Within a few km of a border the simplified line can put a town on the wrong side
    // (Melilla, Eilat, Leticia). An airport within 5 km on the other side settles it.
    ap = nearestAirport(lat, lng);
    if (ap && ap.cc !== p && km([lat, lng], [ap.lat, ap.lng]) < BORDER_AIRPORT_KM && nearestBorder(lat, lng, BORDER_FUZZ_KM, ap.cc)) return ap.cc;
    return p;
  }
  // Just off a simplified coastline (beaches and harbours often are): use the country whose
  // border is nearest. The nearest airport's country was wrong near small neighbours, such as
  // Marbella's coast coming out as Gibraltar, whose airport is closer than Málaga's.
  // An airport closer than any border still wins, for small islands the simplified borders
  // leave out (Kastelorizo, Matsu, Macau's airport) and further out at sea.
  var near = nearestBorder(lat, lng, NEAR_BORDER_KM);
  ap = nearestAirport(lat, lng);
  if (near && !(ap && km([lat, lng], [ap.lat, ap.lng]) < near.km)) return territoryAt(lat, lng, near.cc) || near.cc;
  return ap ? ap.cc : '';
}
var BORDER_AIRPORT_KM = 5, BORDER_FUZZ_KM = 3;
// The country whose borders hold a place, or ''.
function polyCountry(lat, lng) {
  var cell = CB.grid[Math.floor(lng / 5) + ',' + Math.floor(lat / 5)] || [], inside = {};
  // Even-odd test over all of a country's rings, so holes (like Lesotho inside South Africa) work.
  for (var k = 0; k < cell.length; k++) {
    var e = cell[k];
    if (lng < e.minX || lng > e.maxX || lat < e.minY || lat > e.maxY) continue;
    var R = e.ring, n = R.length, hit = false;
    for (var i = 0, j = n - 2; i < n; j = i, i += 2) {
      if ((R[i + 1] > lat) !== (R[j + 1] > lat) && lng < (R[j] - R[i]) * (lat - R[i + 1]) / (R[j + 1] - R[i + 1]) + R[i]) hit = !hit;
    }
    if (hit) inside[e.cc] = !inside[e.cc];
  }
  for (var cc in inside) if (inside[cc]) return cc;
  return '';
}
// Territories with airports but no borders of their own, found from the data: each airport
// whose country has no borders, under the country whose borders hold it.
var TERR = null;
function territoryAt(lat, lng, parent) {
  if (!TERR) {
    if (!AP) buildAirports();
    TERR = {};
    AP.all.forEach(function (a) {
      if (CB.rings[a.cc]) return;
      var pc = polyCountry(a.lat, a.lng);
      if (pc) (TERR[pc] || (TERR[pc] = [])).push(a);
    });
  }
  var list = TERR[parent];
  if (!list) return '';
  var best = null, bd = TERRITORY_KM;
  for (var k = 0; k < list.length; k++) {
    var d = km([lat, lng], [list[k].lat, list[k].lng]);
    if (d < bd) { bd = d; best = list[k]; }
  }
  if (!best) return '';
  // Still the country itself where one of its own airports is closer.
  var own = AP.byCc[parent] || [];
  for (k = 0; k < own.length; k++) if (km([lat, lng], [own[k].lat, own[k].lng]) < bd) return '';
  return best.cc;
}
var TERRITORY_KM = 300;
var NEAR_BORDER_KM = 25;
// The country whose border is nearest a place, within maxKm, as {cc, km}, or null.
// With only, just that country's border.
function nearestBorder(lat, lng, maxKm, only) {
  var r = Math.PI / 180, kx = 111.32 * Math.cos(lat * r), ky = 110.57, dLat = maxKm / ky, dLng = maxKm / Math.max(kx, 1);
  var best = '', bd = maxKm * maxKm, seen = new Set();
  for (var gx = Math.floor((lng - dLng) / 5); gx <= Math.floor((lng + dLng) / 5); gx++)
    for (var gy = Math.floor((lat - dLat) / 5); gy <= Math.floor((lat + dLat) / 5); gy++) {
      var cell = CB.grid[gx + ',' + gy] || [];
      for (var k = 0; k < cell.length; k++) {
        var e = cell[k];
        if ((only && e.cc !== only) || seen.has(e.ring) || lng < e.minX - dLng || lng > e.maxX + dLng || lat < e.minY - dLat || lat > e.maxY + dLat) continue;
        seen.add(e.ring);
        var R = e.ring, n = R.length;
        // Distance to each edge on a flat projection around the place, which is close enough within 25 km.
        for (var i = 0, j = n - 2; i < n; j = i, i += 2) {
          var ax = (R[j] - lng) * kx, ay = (R[j + 1] - lat) * ky, bx = (R[i] - lng) * kx, by = (R[i + 1] - lat) * ky;
          var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
          var px = ax + t * dx, py = ay + t * dy, d2 = px * px + py * py;
          if (d2 < bd) { bd = d2; best = e.cc; }
        }
      }
    }
  return best ? { cc: best, km: Math.sqrt(bd) } : null;
}
var countryNames = null;
try { countryNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch (e) { /* older browser */ }
function country(cc) { try { return countryNames ? countryNames.of(cc) : cc; } catch (e) { return cc; } }
function ccName(cc) { return cc ? country(cc) : 'Unknown place'; }
function flag(cc) { return /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(127397 + cc.charCodeAt(0), 127397 + cc.charCodeAt(1)) : ''; }

// ---------- airports and towns ----------
var AP = null;
function buildAirports() {
  AP = { grid: {}, all: [], byCc: {} };
  AIRPORTS.split(';').forEach(function (row) {
    var f = row.split('|');
    if (f.length < 6) return;
    var a = { code: f[0], lat: +f[1], lng: +f[2], city: f[3], cc: f[4], w: f[5] === 'L' ? 0.6 : f[5] === 'M' ? 0.8 : 1 };
    var key = Math.floor(a.lat) + ',' + Math.floor(a.lng);
    (AP.grid[key] || (AP.grid[key] = [])).push(a);
    AP.all.push(a); (AP.byCc[a.cc] || (AP.byCc[a.cc] = [])).push(a);
  });
}
function nearestAirport(lat, lng) {
  if (!isFinite(lat)) return null;
  if (!AP) buildAirports();
  var best = null, bs = Infinity, la = Math.floor(lat), lo = Math.floor(lng);
  for (var dy = -1; dy <= 1; dy++) for (var dx = -2; dx <= 2; dx++) {
    var cell = AP.grid[(la + dy) + ',' + (((lo + dx + 180) % 360 + 360) % 360 - 180)];
    if (!cell) continue;
    for (var k = 0; k < cell.length; k++) {
      var d = km([lat, lng], [cell[k].lat, cell[k].lng]);
      // Bigger airports win when two are similarly close.
      if (d <= 80 && d * cell[k].w < bs) { bs = d * cell[k].w; best = cell[k]; }
    }
  }
  return best;
}
var CT = null;
function buildCities() {
  CT = {};
  var la = 0, lo = 0;
  CITIES.split(';').forEach(function (e) {
    var f = e.split(','), n = f.length;
    la += parseInt(f[n - 2], 36); lo += parseInt(f[n - 1], 36);
    var c = { name: f.slice(0, n - 3).join(','), w: [1, 1.4, 2, 2.6][+f[n - 3]], lat: la / 100, lng: lo / 100 }, key = Math.floor(c.lat) + ',' + Math.floor(c.lng);
    (CT[key] || (CT[key] = [])).push(c);
  });
}
// The town or city a place belongs to (within 60 km), with its distance in km.
function nearestCity(lat, lng) {
  if (!CT) buildCities();
  // Bigger places win when a small town is only a little closer, as people name them that way.
  var best = null, bs = Infinity, bd = 0, la = Math.floor(lat), lo = Math.floor(lng);
  for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
    var cell = CT[(la + dy) + ',' + (((lo + dx + 180) % 360 + 360) % 360 - 180)];
    if (cell) for (var k = 0; k < cell.length; k++) {
      var d = km([lat, lng], [cell[k].lat, cell[k].lng]);
      if (d < 60 && d / cell[k].w < bs) { bs = d / cell[k].w; bd = d; best = cell[k]; }
    }
  }
  return best && { name: best.name, d: bd };
}

// ---------- time zones ----------
// Countries the time zone data leaves out.
var SMALL_ZONES = { VA: 'Europe/Vatican', MC: 'Europe/Monaco' };
var TZP = null;
function zoneAt(lat, lng) {
  if (typeof TZDATA === 'undefined' || !isFinite(lat)) return null;
  var cc = countryAt(lat, lng);
  if (cc && TZDATA.s[cc] != null) return TZDATA.z[TZDATA.s[cc]];
  if (SMALL_ZONES[cc]) return SMALL_ZONES[cc];
  if (!TZP) TZP = TZDATA.p.split(';').map(function (x) { var f = x.slice(2).split(','); return { cc: x.slice(0, 2), lat: +f[0], lng: +f[1], z: +f[2] }; });
  var best = null, bd = Infinity;
  for (var k = 0; k < TZP.length; k++) {
    var p = TZP[k];
    if (cc && p.cc !== cc) continue;
    var d = km([lat, lng], [p.lat, p.lng]);
    if (d < bd) { bd = d; best = p; }
  }
  return best && (cc || bd < 300) ? TZDATA.z[best.z] : null;
}
// Minutes east of UTC in a zone at a moment, or null for a zone this browser doesn't know.
// Cached by the hour, which is when clocks change.
var TZF = {}, TZO = {};
function zoneOffset(zone, ms) {
  var key = zone + '@' + Math.floor(ms / 36e5);
  if (key in TZO) return TZO[key];
  var f = TZF[zone];
  if (f === undefined) try {
    f = TZF[zone] = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });
  } catch (e) { f = TZF[zone] = null; }
  if (!f) return (TZO[key] = null);
  var p = {}, at = Math.floor(ms / 36e5) * 36e5;
  f.formatToParts(new Date(at)).forEach(function (x) { p[x.type] = x.value; });
  return (TZO[key] = Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - at) / 60000));
}
function tzLabel(off) {
  if (off == null || off === NO_OFF) return 'your time zone';
  var a = Math.abs(off);
  return 'UTC' + (off < 0 ? '−' : '+') + Math.floor(a / 60) + (a % 60 ? ':' + pad2(a % 60) : '');
}
// {time, date, label} for a moment in a zone; falls back to the offset in the file.
function localTime(ms, zone, off) {
  if (zone) try {
    var parts = {};
    new Intl.DateTimeFormat('en-GB', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'shortOffset' })
      .formatToParts(new Date(ms)).forEach(function (p) { parts[p.type] = p.value; });
    var utc = (parts.timeZoneName || '').replace('GMT', 'UTC').replace('-', '−');
    if (utc === 'UTC') utc = 'UTC+0';
    return { time: parts.hour + ':' + parts.minute, date: +parts.day + ' ' + MONTHS[+parts.month - 1] + ' ' + parts.year,
      label: zone.split('/').pop().replace(/_/g, ' ') + ' time, ' + utc };
  } catch (e) { /* unknown zone: fall through */ }
  var full = clock(ms, off, true).split(', ');
  return { time: full[1], date: full[0], label: tzLabel(off) };
}
