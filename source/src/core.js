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
  // Material Icons: more_horiz.
  more: 'M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
  // Material Icons: call_split and undo.
  split: 'M14 4l2.29 2.29-2.88 2.88 1.42 1.42 2.88-2.88L20 10V4h-6zm-4 0H4v6l2.29-2.29 4.71 4.7V20h2v-8.41l-5.29-5.3L10 4z',
  select: 'M17 5h-2V3h2v2zm-2 16h2v-2.59L19.59 21 21 19.59 18.41 17H21v-2h-6v6zm4-12h2V7h-2v2zm0 4h2v-2h-2v2zm-8 8h2v-2h-2v2zM7 5h2V3H7v2zM3 17h2v-2H3v2zm2 4v-2H3c0 1.1.9 2 2 2zM19 3v2h2c0-1.1-.9-2-2-2zm-8 2h2V3h-2v2zM3 9h2V7H3v2zm4 12h2v-2H7v2zm-4-8h2v-2H3v2zm0-8h2V3c-1.1 0-2 .9-2 2z',
  undo: 'M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z',
  pin: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z',
  chart: 'M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z',
  history: 'M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z',
  // Material Icons: filter_alt (the Filters button) and menu (the Menu button).
  filter: 'M4.25 5.61C6.27 8.2 10 13 10 13v6c0 .55.45 1 1 1h2c.55 0 1-.45 1-1v-6s3.72-4.8 5.74-7.39c.51-.66.04-1.61-.79-1.61H5.04c-.83 0-1.3.95-.79 1.61z',
  menu: 'M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z',
  layers: 'M11.99 18.54l-7.37-5.73L3 14.07l9 7 9-7-1.63-1.27-7.38 5.74zM12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27L12 16z',
  gear: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
  expand: 'M21 11V3h-8l3.29 3.29-10 10L3 13v8h8l-3.29-3.29 10-10z',
  search: 'M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  close: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  left: 'M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z',
  down: 'M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z',
  file: 'M6 2c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6H6zm7 7V3.5L18.5 9H13z',
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
  restaurant: 'M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z',
  cafe: 'M20 3H4v10c0 2.21 1.79 4 4 4h6c2.21 0 4-1.79 4-4v-3h2c1.11 0 2-.89 2-2V5c0-1.11-.89-2-2-2zm0 5h-2V5h2v3zM4 19h16v2H4z',
  basketball: 'M17.09 11h4.86a9.951 9.951 0 0 0-1.54-4.4 5.987 5.987 0 0 0-3.32 4.4zM6.91 11a5.987 5.987 0 0 0-3.32-4.4A9.951 9.951 0 0 0 2.05 11h4.86zm8.16 0a7.994 7.994 0 0 1 4.06-6A9.969 9.969 0 0 0 13 2.05V11h2.07zm-6.14 0H11V2.05A9.943 9.943 0 0 0 4.87 5a7.994 7.994 0 0 1 4.06 6zm6.14 2H13v8.95A9.943 9.943 0 0 0 19.13 19a7.994 7.994 0 0 1-4.06-6zM3.59 17.4A6.029 6.029 0 0 0 6.91 13H2.05c.16 1.61.71 3.11 1.54 4.4zm13.5-4.4a5.987 5.987 0 0 0 3.32 4.4 9.951 9.951 0 0 0 1.54-4.4h-4.86zm-8.16 0a7.994 7.994 0 0 1-4.06 6A9.969 9.969 0 0 0 11 21.95V13H8.93z',
  store: 'm21.9 8.89-1.05-4.37c-.22-.9-1-1.52-1.91-1.52H5.05c-.9 0-1.69.63-1.9 1.52L2.1 8.89c-.24 1.02-.02 2.06.62 2.88.08.11.19.19.28.29V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-6.94c.09-.09.2-.18.28-.28.64-.82.87-1.87.62-2.89zm-2.99-3.9 1.05 4.37c.1.42.01.84-.25 1.17-.14.18-.44.47-.94.47-.61 0-1.14-.49-1.21-1.14L16.98 5l1.93-.01zM13 5h1.96l.54 4.52c.05.39-.07.78-.33 1.07-.22.26-.54.41-.95.41-.67 0-1.22-.59-1.22-1.31V5zM8.49 9.52 9.04 5H11v4.69c0 .72-.55 1.31-1.29 1.31-.34 0-.65-.15-.89-.41a1.42 1.42 0 0 1-.33-1.07zm-4.45-.16L5.05 5h1.97l-.58 4.86c-.08.65-.6 1.14-1.21 1.14-.49 0-.8-.29-.93-.47-.27-.32-.36-.75-.26-1.17zM5 19v-6.03c.08.01.15.03.23.03.87 0 1.66-.36 2.24-.95.6.6 1.4.95 2.31.95.87 0 1.65-.36 2.23-.93.59.57 1.39.93 2.29.93.84 0 1.64-.35 2.24-.95.58.59 1.37.95 2.24.95.08 0 .15-.02.23-.03V19H5z',
  friends: 'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z',
  cart: 'M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49A1.003 1.003 0 0 0 20 4H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z',
  work: 'M20 6h-4V4c0-1.11-.89-2-2-2h-4c-1.11 0-2 .89-2 2v2H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-6 0h-4V4h4v2z',
  school: 'M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82zM12 3 1 9l11 6 9-4.91V17h2V9L12 3z',
  bolt: 'M7 2v11h3v9l7-12h-4l4-8z',
  ruler: 'M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 10H3V8h2v4h2V8h2v4h2V8h2v4h2V8h2v4h2V8h2v8z',
  // Material Icons: edit and location_off.
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  // Material Icons: visibility_off (Hide this trip) and group_work (Group with similar trips).
  hide: 'M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z',
  groupWork: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM8 17.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5zM9.5 8c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5S9.5 9.38 9.5 8zm6.5 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z',
  pinOff: 'M12 6.5c1.38 0 2.5 1.12 2.5 2.5 0 .74-.33 1.39-.83 1.85l3.63 3.63c.98-1.86 1.7-3.8 1.7-5.48 0-3.87-3.13-7-7-7-1.98 0-3.76.83-5.04 2.15l3.19 3.19c.46-.52 1.11-.84 1.85-.84zm4.37 9.6l-4.63-4.63-.11-.11L3.27 3 2 4.27l3.18 3.18C5.07 7.95 5 8.47 5 9c0 5.25 7 13 7 13s1.67-1.85 3.38-4.35L18.73 21 20 19.73l-3.63-3.63z',
  info: 'M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z',
  help: 'M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z',
  shield: 'M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z',
  left2:'M17.59 18L19 16.59 14.42 12 19 7.41 17.59 6l-6 6zM11 18l1.41-1.41L7.83 12l4.58-4.59L11 6l-6 6z',
  right2: 'M6.41 6L5 7.41 9.58 12 5 16.59 6.41 18l6-6zM13 6l-1.41 1.41L16.17 12l-4.58 4.59L13 18l6-6z',
  clock: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z',
  // Transport
  WALKING: 'M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7',
  RUNNING: 'M13.49 5.48c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm-3.6 13.9l1-4.4 2.1 2v6h2v-7.5l-2.1-2 .6-3c1.3 1.5 3.3 2.5 5.5 2.5v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1l-5.2 2.2v4.7h2v-3.4l1.8-.7-1.6 8.1-4.9-1-.4 2 7 1.4z',
  // Material's pedal_bike.
  CYCLING: 'm18.18 10-1.7-4.68A2.008 2.008 0 0 0 14.6 4H12v2h2.6l1.46 4h-4.81l-.36-1H12V7H7v2h1.75l1.82 5H9.9c-.44-2.23-2.31-3.88-4.65-3.99C2.45 9.87 0 12.2 0 15c0 2.8 2.2 5 5 5 2.46 0 4.45-1.69 4.9-4h4.2c.44 2.23 2.31 3.88 4.65 3.99 2.8.13 5.25-2.19 5.25-5 0-2.8-2.2-5-5-5h-.82zM7.82 16c-.4 1.17-1.49 2-2.82 2-1.68 0-3-1.32-3-3s1.32-3 3-3c1.33 0 2.42.83 2.82 2H5v2h2.82zm6.28-2h-1.4l-.73-2H15c-.44.58-.76 1.25-.9 2zm4.9 4c-1.68 0-3-1.32-3-3 0-.93.41-1.73 1.05-2.28l.96 2.64 1.88-.68-.97-2.67c.03 0 .06-.01.09-.01 1.68 0 3 1.32 3 3s-1.33 3-3.01 3z',
  // Gear with an icon of its own, filled like the Material ones (drawn in Figma, file
  // eUKGzR3PYw76kinfceKrXb, node 48570:2847).
  halfbike: 'M2.01562 20.8594C2.01562 21.4807 2.5193 21.9844 3.14062 21.9844L3.14062 24C1.40611 24 0 22.5939 0 20.8594C0 19.1249 1.40611 17.7188 3.14062 17.7188C4.87514 17.7188 6.28125 19.1249 6.28125 20.8594C6.28125 22.5939 4.87514 24 3.14062 24L3.14062 21.9844C3.76195 21.9844 4.26562 21.4807 4.26562 20.8594C4.26562 20.2381 3.76195 19.7344 3.14062 19.7344C2.5193 19.7344 2.01562 20.2381 2.01562 20.8594ZM16.0478 0L16.3135 0.599304L15.3921 1.00781C16.3135 0.59933 16.3136 0.599525 16.3137 0.599762C16.3137 0.599762 16.3139 0.60021 16.314 0.600494C16.3143 0.601098 16.3146 0.601934 16.3151 0.602966C16.316 0.605024 16.3173 0.607926 16.3189 0.611664C16.3222 0.619181 16.327 0.630108 16.3332 0.644257C16.3456 0.672569 16.3637 0.713977 16.3869 0.76767C16.4333 0.875065 16.5003 1.03174 16.584 1.23138C16.7513 1.63056 16.9855 2.20222 17.2546 2.89618C17.792 4.28176 18.4731 6.16564 19.0398 8.14325C19.6031 10.1092 20.0693 12.2217 20.1482 14.0482C20.1877 14.9618 20.1329 15.8522 19.9165 16.6372C19.699 17.4263 19.2999 18.1701 18.6094 18.6843C17.4236 19.5672 16.176 19.6904 14.9884 19.5317C13.8879 19.3846 12.6633 18.9569 11.6404 18.6794C10.546 18.3825 9.49679 18.1901 8.41418 18.3279C7.35439 18.4627 6.18048 18.9256 4.86907 20.0831L3.53515 18.5719C5.11789 17.1749 6.65969 16.5193 8.15975 16.3284C9.637 16.1404 10.9919 16.415 12.1682 16.7341C13.416 17.0726 14.329 17.41 15.2554 17.5338C16.0946 17.646 16.7633 17.5458 17.4057 17.0675C17.6292 16.9011 17.8339 16.6072 17.9733 16.1017C18.1138 15.592 18.1689 14.9306 18.1345 14.1352C18.0658 12.5437 17.6497 10.6093 17.1022 8.69852C16.558 6.79944 15.8997 4.97681 15.3754 3.62503C15.1149 2.95328 14.8885 2.40046 14.7272 2.01562H12.2831V0H16.0478ZM21.9844 17.8594C21.9844 15.5812 20.1376 13.7344 17.8594 13.7344C15.5812 13.7344 13.7344 15.5812 13.7344 17.8594C13.7344 20.1376 15.5812 21.9844 17.8594 21.9844V24C14.468 24 11.7188 21.2507 11.7188 17.8594C11.7188 14.468 14.468 11.7188 17.8594 11.7188C21.2507 11.7188 24 14.468 24 17.8594C24 21.2507 21.2507 24 17.8594 24V21.9844C20.1376 21.9844 21.9844 20.1376 21.9844 17.8594Z',
  strida: 'M12.7181 0.24C13.4816 0.2401 14.1674 0.7033 14.4543 1.4081L14.4675 1.4419L19.7353 15.1303C19.8012 15.1271 19.8674 15.1257 19.934 15.1257C22.1796 15.1257 24 16.946 24 19.1916C24 21.4371 22.1796 23.2575 19.934 23.2575C17.6886 23.2574 15.8681 21.4371 15.8681 19.1916C15.8681 18.4694 16.0574 17.7919 16.3875 17.2041H15.1472C14.7212 18.0137 13.8519 18.57 12.8465 18.57C11.8413 18.5699 10.9728 18.0135 10.5468 17.2041H8.5725C8.9026 17.7919 9.0919 18.4694 9.0919 19.1916C9.0919 21.4371 7.2714 23.2574 5.0259 23.2575C2.7804 23.2575 0.96 21.4371 0.96 19.1916C0.96 16.946 2.7804 15.1257 5.0259 15.1257C5.4067 15.1257 5.7751 15.1787 6.1247 15.2766L8.5819 8.8687H6.5166V6.9262H9.3262L9.9047 5.4187L9.9187 5.385C10.2053 4.6792 10.8918 4.2159 11.6559 4.2159H13.454L12.6712 2.1825H10.1756V0.24H12.7181ZM5.0259 17.0681C3.8533 17.0681 2.9025 18.0189 2.9025 19.1916C2.9025 20.3642 3.8533 21.315 5.0259 21.315C6.1986 21.315 7.1494 20.3642 7.1494 19.1916C7.1494 18.0189 6.1986 17.0681 5.0259 17.0681ZM19.934 17.0681C18.7614 17.0681 17.8106 18.0189 17.8106 19.1916C17.8107 20.3642 18.7615 21.315 19.934 21.315C21.1068 21.315 22.0574 20.3642 22.0575 19.1916C22.0575 18.0189 21.1068 17.0681 19.934 17.0681ZM14.1966 6.1584H11.7019L8.2116 15.2616H10.4119C10.7628 14.2888 11.7189 13.5901 12.8465 13.59C13.9744 13.59 14.9312 14.2887 15.2821 15.2616H17.7057L14.1966 6.1444V6.1584Z',
  cargobike: 'M10.4062 5C11.2176 5 11.9441 5.50381 12.2285 6.26367L13.335 9.21875H22.7812V11.6094L17.4375 16.4375H16.5V16.4395L6.78027 16.4375C6.34105 17.8495 5.02524 18.875 3.46875 18.875C1.55301 18.875 0 17.322 0 15.4062C0 13.4905 1.55301 11.9375 3.46875 11.9375C5.05946 11.9375 6.3985 13.0087 6.80762 14.4688H7.88281L6.38184 10.3203H4.875V8.30469H9.46875V10.3203H8.52539L10.0264 14.4688H11.5312V10.1514L10.3574 7.01562H8.41406V5H10.4062ZM21.5625 14C22.9087 14 24 15.0913 24 16.4375C24 17.7837 22.9087 18.875 21.5625 18.875C20.2163 18.875 19.125 17.7837 19.125 16.4375C19.125 15.0913 20.2163 14 21.5625 14ZM3.46875 13.9531C2.66621 13.9531 2.01562 14.6037 2.01562 15.4062C2.01562 16.2088 2.66621 16.8594 3.46875 16.8594C4.27129 16.8594 4.92188 16.2088 4.92188 15.4062C4.92188 14.6037 4.27129 13.9531 3.46875 13.9531ZM21.5625 16.0156C21.3295 16.0156 21.1406 16.2045 21.1406 16.4375C21.1406 16.6705 21.3295 16.8594 21.5625 16.8594C21.7955 16.8594 21.9844 16.6705 21.9844 16.4375C21.9844 16.2045 21.7955 16.0156 21.5625 16.0156Z',
  // Cycling sports from the data (Strava) with a Material icon of their own: electric_bike and
  // accessible_forward (for a handcycle).
  ebike: 'M19 7h-.82l-1.7-4.68A2.008 2.008 0 0 0 14.6 1H12v2h2.6l1.46 4h-4.81l-.36-1H12V4H7v2h1.75l1.82 5H9.9c-.44-2.23-2.31-3.88-4.65-3.99C2.45 6.87 0 9.2 0 12c0 2.8 2.2 5 5 5 2.46 0 4.45-1.69 4.9-4h4.2c.44 2.23 2.31 3.88 4.65 3.99 2.8.13 5.25-2.19 5.25-5C24 9.2 21.8 7 19 7zM7.82 13c-.4 1.17-1.49 2-2.82 2-1.68 0-3-1.32-3-3s1.32-3 3-3c1.33 0 2.42.83 2.82 2H5v2h2.82zm6.28-2h-1.4l-.73-2H15c-.44.58-.76 1.25-.9 2zm4.9 4c-1.68 0-3-1.32-3-3 0-.93.41-1.73 1.05-2.28l.96 2.64 1.88-.68-.97-2.67c.02 0 .05-.01.08-.01 1.68 0 3 1.32 3 3s-1.32 3-3 3zm-8 5H7l6 3v-2h4l-6-3z',
  handcycle: 'M17 2.54a2 2 0 1 0 0 4 2 2 0 1 0 0-4zM14 17h-2c0 1.65-1.35 3-3 3s-3-1.35-3-3 1.35-3 3-3v-2c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5zm3-3.5h-1.86l1.67-3.67C17.42 8.5 16.44 7 14.96 7h-5.2c-.81 0-1.54.47-1.87 1.2L7.22 10l1.92.53L9.79 9H12l-1.83 4.1c-.6 1.33.39 2.9 1.85 2.9H17v5h2v-5.5c0-1.1-.9-2-2-2z',
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
  // World landmarks for the loading screen (Material Icons, filled).
  castle: 'M21 9v2h-2V3h-2v2h-2V3h-2v2h-2V3H9v2H7V3H5v8H3V9H1v12h9v-3c0-1.1.9-2 2-2s2 .9 2 2v3h9V9h-2zm-10 3H9V9h2v3zm4 0h-2V9h2v3z',
  temple_buddhist: 'M21 9.02c0 1.09-.89 1.98-1.98 1.98H4.98C3.89 11 3 10.11 3 9.02H1c0 1.86 1.28 3.4 3 3.84V22h6v-3c0-1.1.9-2 2-2s2 .9 2 2v3h6v-9.14c.55-.14 3-1.04 3-3.86l-2 .02z M6 8.86V10h12V8.86c.55-.14 3-1.04 3-3.86l-2 .02C19 6.11 18.11 7 17.02 7H6.98C5.89 7 5 6.11 5 5.02H3c0 1.85 1.28 3.4 3 3.84z M12 1 8.25 6h7.5z',
  mosque: 'M7 8h10c.29 0 .57.06.84.13.09-.33.16-.67.16-1.04 0-1.31-.65-2.53-1.74-3.25L12 1 7.74 3.84A3.887 3.887 0 0 0 6 7.09c0 .37.07.71.16 1.04.27-.07.55-.13.84-.13z M24 7c0-1.1-2-3-2-3s-2 1.9-2 3c0 .74.4 1.38 1 1.72V13h-2v-2c0-1.1-.9-2-2-2H7c-1.1 0-2 .9-2 2v2H3V8.72c.6-.34 1-.98 1-1.72 0-1.1-2-3-2-3S0 5.9 0 7c0 .74.4 1.38 1 1.72V21h9v-4c0-1.1.9-2 2-2s2 .9 2 2v4h9V8.72c.6-.34 1-.98 1-1.72z',
  church: 'M18 12.22V9l-5-2.5V5h2V3h-2V1h-2v2H9v2h2v1.5L6 9v3.22L2 14v8h8v-3c0-1.1.9-2 2-2s2 .9 2 2v3h8v-8l-4-1.78zm-6 1.28c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z',
  account_balance: 'M4 10h3v7H4zm6.5 0h3v7h-3zM2 19h20v3H2zm15-9h3v7h-3zm-5-9L2 6v2h20V6z',
  temple_hindu: 'M6.6 11h10.8l-.9-3h-9zM20 11v2H4v-2H2v11h8v-5h4v5h8V11zm-4.1-5L15 3V1h-2v2h-2.03V1h-2v2.12L8.1 6z',
  stadium: 'M7 5 3 7V3l4 2zm11-2v4l4-2-4-2zm-7-1v4l4-2-4-2zm-6 8.04c1.38.49 3.77.96 7 .96s5.62-.47 7-.96C19 9.86 16.22 9 12 9s-7 .86-7 1.04zM15 17H9v4.88c-4.06-.39-7-1.54-7-2.88v-9c0-1.66 4.48-3 10-3s10 1.34 10 3v9c0 1.34-2.94 2.48-7 2.87V17z',
  synagogue: 'M6 8v13h4v-5c0-1.1.9-2 2-2s2 .9 2 2v5h4V8l-6-5-6 5zm7.5 2c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5.67-1.5 1.5-1.5 1.5.67 1.5 1.5zM3 5c-1.1 0-2 .9-2 2v1h4V7c0-1.1-.9-2-2-2zM1 9h4v12H1zm20-4c-1.1 0-2 .9-2 2v1h4V7c0-1.1-.9-2-2-2zm-2 4h4v12h-4z',
  attractions: 'M10.43 18.75c.37-.46.94-.75 1.57-.75.63 0 1.19.29 1.56.75.39-.09.76-.21 1.12-.36l-1.42-3.18a3.522 3.522 0 0 1-2.56-.02l-1.43 3.19c.38.16.76.29 1.16.37zM5.15 10a7.06 7.06 0 0 0 .08 4c.63.05 1.22.4 1.56.99.33.57.35 1.23.11 1.79.27.27.56.53.87.76l1.52-3.39c-.47-.58-.75-1.32-.75-2.13 0-1.89 1.55-3.41 3.46-3.41s3.46 1.53 3.46 3.41c0 .82-.29 1.57-.78 2.16l1.5 3.35c.32-.24.62-.5.9-.79-.22-.55-.2-1.2.12-1.75.33-.57.9-.92 1.52-.99a7.025 7.025 0 0 0 .09-4.02c-.64-.04-1.26-.39-1.6-1-.36-.62-.35-1.36-.03-1.95-.91-.98-2.1-1.71-3.44-2.05C13.39 5.6 12.74 6 12 6s-1.39-.41-1.74-1.01a7.053 7.053 0 0 0-3.44 2.03c.33.6.35 1.35-.02 1.98-.35.62-.99.97-1.65 1zm-1.3-.42c-.78-.6-1.02-1.7-.51-2.58.51-.88 1.58-1.23 2.49-.85a8.53 8.53 0 0 1 4.18-2.42C10.15 2.75 10.99 2 12 2s1.85.75 1.98 1.73c1.63.39 3.07 1.24 4.18 2.42a1.99 1.99 0 0 1 2.49.85c.51.88.27 1.98-.51 2.58.23.77.35 1.58.35 2.42s-.12 1.65-.35 2.42c.78.6 1.02 1.7.51 2.58-.51.88-1.58 1.23-2.49.85-.4.43-.85.81-1.34 1.15l1.34 3H16.3l-.97-2.17c-.43.18-.88.33-1.34.44-.14.98-.98 1.73-1.99 1.73s-1.85-.75-1.98-1.73c-.48-.12-.94-.27-1.38-.46L7.66 22H5.78l1.36-3.03a8.72 8.72 0 0 1-1.3-1.12c-.92.38-1.99.03-2.5-.85s-.27-1.98.51-2.58c-.23-.77-.35-1.58-.35-2.42s.12-1.65.35-2.42z',
  fort: 'M21 3v2h-2V3h-2v2h-2V3h-2v4l2 2v1H9V9l2-2V3H9v2H7V3H5v2H3V3H1v4l2 2v6l-2 2v4h9v-3c0-1.1.9-2 2-2s2 .9 2 2v3h9v-4l-2-2V9l2-2V3h-2z',
  flag: 'M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z',
  zoomOut: 'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14zM7 9h5v1H7z',
  zoomIn: 'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14zm2.5-4h-2v2H9v-2H7V9h2V7h1v2h2v1z',
  // Sunrise and sunset (the sun on the horizon with an arrow up or down), the sun and the night, for day playback.
  sunrise: 'M2 17h20v2H2zm6-1a4 4 0 0 1 8 0zm3-6V6.8L9.4 8.4 8 7l4-4 4 4-1.4 1.4L13 6.8V10z',
  sunset: 'M2 17h20v2H2zm6-1a4 4 0 0 1 8 0zm3-13v3.2L9.4 4.6 8 6l4 4 4-4-1.4-1.4L13 6.2V3z',
  sun: 'M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58c-.39-.39-1.03-.39-1.41 0-.39.39-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37c-.39-.39-1.03-.39-1.41 0-.39.39-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0 .39-.39.39-1.03 0-1.41l-1.06-1.06zm1.06-10.96c.39-.39.39-1.03 0-1.41-.39-.39-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06zM7.05 18.36c.39-.39.39-1.03 0-1.41-.39-.39-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06z',
  night: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  // Unclassified: Material's question_mark.
  UNKNOWN: 'M11.07 12.85c.77-1.39 2.25-2.21 3.11-3.44.91-1.29.4-3.7-2.18-3.7-1.69 0-2.52 1.28-2.87 2.34L6.54 6.96C7.25 4.83 9.18 3 11.99 3c2.35 0 3.96 1.07 4.78 2.41.7 1.15 1.11 3.3.03 4.9-1.2 1.77-2.35 2.31-2.97 3.45-.25.46-.35.76-.35 2.24h-2.89c-.01-.78-.13-2.05.48-3.15zM14 20c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2z'
};
ICONS.VEHICLE = ICONS.CAR;
// Gear icons drawn with lines rather than one filled path: the halfbike (a standing bike with a big
// front wheel, two small ones at the back and a curved frame up to the handlebar) and a front-loading
// cargo bike (the rider of the cycling icon behind a box over a small front wheel).
// Icons drawn as lines (an SVG fragment), not as one filled path; none at the moment.
var LINE_ICONS = {};
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

// ---------- (i) buttons ----------
// Long explanations sit behind a small (i) button so the UI stays clean: the short label stays in
// view and the button opens the rest under it. infoBtn is the button, infoBox the text it opens
// (hidden until then), infoMore a short text with its button and the rest; the click handler in
// data.js opens and closes the box named by the button's aria-controls.
var INFO_N = 0;
// The ⋯ button: the less-used actions of a sheet in a short menu, so each sheet has one main
// action (see docs/design-rules.md). Items are buttons or links with role="menuitem" (moreItem); a
// tap anywhere, an item included, closes it, and the item's own click handler still runs.
// ic: the button's icon (⋯ unless given, e.g. the pencil of a trip's edit menu); cls: a class on its
// wrap ("end" opens the menu from the button's right edge).
function moreMenu(items, label, ic, cls) {
  if (!items.length) return '';
  label = label || 'More';
  return '<span class="more-wrap' + (cls ? ' ' + cls : '') + '"><button type="button" class="btn more-btn" aria-haspopup="menu" aria-expanded="false" aria-label="' + label + '" title="' + label + '">' + icon(ic || 'more') + '</button>' +
    '<span class="more-menu" role="menu" hidden>' + items.join('') + '</span></span>';
}
function moreItem(attrs, ic, text) { return '<button type="button" role="menuitem" ' + attrs + '>' + (ic ? icon(ic) : '') + '<span>' + text + '</span></button>'; }
function moreClose(keep) {
  document.querySelectorAll('.more-menu:not([hidden])').forEach(function (m) {
    if (m === keep) return;
    m.hidden = true; m.previousElementSibling.setAttribute('aria-expanded', 'false');
  });
}
document.addEventListener('click', function (ev) {
  var b = ev.target.closest && ev.target.closest('.more-btn'), m = b && b.nextElementSibling;
  moreClose(m);
  if (!m) return;
  m.hidden = !m.hidden; b.setAttribute('aria-expanded', m.hidden ? 'false' : 'true');
  // Opens from the button's left edge, moved left as far as it needs to stay inside its sheet.
  m.style.left = '';
  if (m.hidden) return;
  var box = (b.closest('.sheet, dialog') || document.body).getBoundingClientRect(), r = m.getBoundingClientRect();
  var over = r.right - Math.min(box.right, innerWidth) + 8;
  if (over > 0) m.style.left = -Math.min(over, r.left - Math.max(box.left, 0) - 8) + 'px';
}, true);
document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') moreClose(null); });
function infoId() { return 'info' + (++INFO_N); }
function infoBtn(id, label, cls) {
  label = label || 'More about this';
  return '<button type="button" class="icon-btn info-btn' + (cls ? ' ' + cls : '') + '" aria-expanded="false" aria-controls="' + id + '" aria-label="' + label + '" title="' + label + '">' + icon('info') + '</button>';
}
function infoBox(id, html, tag) { tag = tag || 'p'; return '<' + tag + ' class="fine info-box" id="' + id + '" hidden>' + html + '</' + tag + '>'; }
function infoMore(short, more, label) {
  if (!more) return short;
  var id = infoId();
  return '<span class="info-line">' + short + infoBtn(id, label, 'sm') + '</span>' + infoBox(id, more, 'span');
}
// A heading with its (i) button and the explanation under it.
function infoHead(tag, cls, title, more, label) {
  var id = infoId();
  return '<div class="info-head"><' + tag + (cls ? ' class="' + cls + '"' : '') + '>' + title + '</' + tag + '>' + infoBtn(id, label) + '</div>' + infoBox(id, more);
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
  { key: 'other', label: 'Other', v: '--m-other', modes: ['SKIING', 'OTHER'] },
  // Trips with no type, or set to Unclassified in Trip info when they look wrong: a kind of their own.
  { key: 'unknown', label: 'Unclassified', v: '--m-unknown', modes: ['UNKNOWN'] }
];
var GROUP_OF = {};
GROUPS.forEach(function (g) { g.color = 'var(' + g.v + ')'; g.modes.forEach(function (m) { GROUP_OF[m] = g; }); });
function groupOf(m) { return GROUP_OF[m] || GROUP_OF.OTHER; }
function modeColor(m) { return groupOf(m).color; }
function modeOf(i) { return MODES[D.mode[i]]; }
// A trip's name: its Strava sport (Kayaking, Mountain bike…) when it has one, else its mode.
function tripLabel(i) { var s = D.sport && D.sport[i]; if (s && SPORTS[s]) return SPORTS[s][1]; if (D.stype && D.stype[i]) return esc(D.stype[i]); var m = modeOf(i); return LABEL[m] || m; }
// app (where a recorded activity came from) adds a mark in the top right corner: Strava's logo for
// Strava, a small track for any other app or device.
var STRAVA_MARK = '<span class="strava-mark" title="From Strava"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.6 1.5 11 10H8.4L6.6 6.6 4.8 10H2.2zM10.3 10.6l1.2 2.4 1.2-2.4h1.9l-3.1 6-3.1-6z" fill="#fff"/></svg></span>';
// Trips from a simulated file (see merge) get a "Simulated" tag wherever they are shown.
function isSim(i) { return !!(D.srcs && D.srcs[i] === SRC.sim); }
function simTag(i) { return (isSim(i) ? '<span class="guess sim">Simulated</span>' : '') + mrTag(i) + splitTag(i); }
var REC_MARK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 12.5c2-.2 2.6-2 4.2-4.6C8.6 5.6 10 4 13 3.5" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><circle cx="3" cy="12.5" r="1.9" fill="#fff"/></svg>';
function recMark(app) { return app === 'Strava' ? STRAVA_MARK : '<span class="strava-mark rec-mark" title="Recorded' + (app ? ' on ' + esc(app) : '') + '">' + REC_MARK + '</span>'; }
function badge(m, small, app, ic) { return '<span class="mode-badge' + (small ? ' sm' : '') + '" style="background:' + modeColor(m) + '">' + icon(ic || m) + (app ? recMark(app === true ? '' : app) : '') + '</span>'; }
// A ride on a cargo bike or a Halfbike shows that bike's icon.
// A trip's icon: its gear's when the gear has one of its own (Halfbike, cargo bike), else its
// sport's when the data names one with an icon (an e-bike ride), else its transport's.
var SPORT_ICON = { ebike: 'ebike', emtb: 'ebike', handcycle: 'handcycle' };
function tripIcon(i) {
  var g = D.gear ? D.gear[i] : 0, sp = D.sport && D.sport[i] && SPORTS[D.sport[i]];
  if (g && (/^(halfbike|cargo|strida)$/.test(GEAR[g].kind))) return gearIcon(g);
  return sp && SPORT_ICON[sp[0]] || modeOf(i);
}

// ---------- preferences ----------
var PREFS_KEY = 'btdt.prefs';
var PREFS = {
  unit: 'km', theme: 'system', proj: 'merc', paths: true, speedPaths: false, squares: false, heat: false, cc: false, pins: false, placeScope: 'all', spotMerge: {},
  dateF: 'auto', timeF: 'auto',
  heatSrc: 'moves', heatBy: 'time', heatSize: 14, heatGain: 50, splitM: 'km', placesM: 'h', timeM: 'km', timeU: 'year', speed: 1,
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
// A short distance given in metres (a radius, a grouping): metres, or feet in miles up to a tenth of a
// mile (25 m reads 80 ft, 100 m 330 ft), then the usual distance.
function distShort(m) {
  if (PREFS.unit === 'mi') { var ft = m * 3.28084; return ft < 528 ? fmt(ft < 100 ? Math.round(ft / 5) * 5 : Math.round(ft / 10) * 10) + ' ft' : dist(m / 1000); }
  return m < 1000 ? fmt(m) + ' m' : dist(m / 1000);
}
// Fixed distances in the page's own text (data-dist-km="1.5"), in the units of Settings.
function fillDists() { document.querySelectorAll('[data-dist-km]').forEach(function (el) { el.textContent = dist(+el.getAttribute('data-dist-km')); }); }
// A distance typed in a form, in the units of Settings, and back to km for saving. distField shows a
// stored km value rounded to 0.1; distSave keeps the stored km when that shown value wasn't changed,
// so opening and saving a rule doesn't nudge it by the rounding.
function distField(kmv) { return kmv != null && isFinite(kmv) ? Math.round(distVal(kmv) * 10) / 10 : ''; }
function distSave(v, kmv) { if (!(v > 0)) return null; if (kmv != null && v === distField(kmv)) return kmv; return PREFS.unit === 'mi' ? v / MI : v; }
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
// ---------- date and time format ----------
// PREFS.dateF is 'auto', 'dmy' (17 Nov 2026), 'mdy' (Nov 17, 2026) or 'ymd' (2026-11-17);
// PREFS.timeF is 'auto', '24' (14:05) or '12' (2:05 PM). Auto follows this device's language
// and region (the order of day, month and year, and its 12- or 24-hour clock).
var LOCALE_FMT = (function () {
  var o = { order: 'dmy', h12: false, unit: 'km' };
  try {
    var lang = (navigator.languages && navigator.languages[0]) || navigator.language || 'en-GB';
    var seq = new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'short', day: 'numeric' }).formatToParts(new Date(Date.UTC(2026, 10, 17, 12)))
      .filter(function (p) { return /^(day|month|year)$/.test(p.type); }).map(function (p) { return p.type[0]; }).join('');
    o.order = seq === 'mdy' ? 'mdy' : seq === 'ymd' ? 'ymd' : 'dmy';
    var hc = new Intl.DateTimeFormat(lang, { hour: 'numeric' }).resolvedOptions();
    o.h12 = hc.hourCycle ? /h1[12]/.test(hc.hourCycle) : !!hc.hour12;
    // Miles in the US, the UK, Liberia and Myanmar; kilometres everywhere else.
    var region = '';
    try { region = new Intl.Locale(lang).maximize().region || ''; } catch (e2) { region = (/[-_]([A-Za-z]{2})\b/.exec(lang) || [])[1] || ''; }
    o.unit = /^(US|GB|LR|MM)$/i.test(region) ? 'mi' : 'km';
  } catch (e) { /* old browser: day first, 24-hour */ }
  return o;
})();
// PREFS.unitF is 'auto', 'km' or 'mi'; PREFS.unit is the unit in use. Before units followed the
// device, km was the default, so a saved km means not chosen and becomes Automatic; a saved mi stays.
if (!/^(auto|km|mi)$/.test(PREFS.unitF)) PREFS.unitF = PREFS.unit === 'mi' ? 'mi' : 'auto';
function resolveUnit() { PREFS.unit = PREFS.unitF === 'auto' ? LOCALE_FMT.unit : PREFS.unitF; }
resolveUnit();
function dateOrder() { return /^(dmy|mdy|ymd)$/.test(PREFS.dateF) ? PREFS.dateF : LOCALE_FMT.order; }
function use12h() { return PREFS.timeF === '12' || PREFS.timeF !== '24' && LOCALE_FMT.h12; }
// A clock time from hours and minutes: 14:05 or 2:05 PM.
function fmtHM(h, m) {
  h = ((h % 24) + 24) % 24;
  return use12h() ? ((h % 12) || 12) + ':' + pad2(m) + '\u202f' + (h < 12 ? 'AM' : 'PM') : pad2(h) + ':' + pad2(m);
}
// A whole hour: 14:00 or 2 PM; short is for tight axes (14 or 2p).
function fmtHour(h, short) {
  h = ((h % 24) + 24) % 24;
  if (!use12h()) return short ? String(h) : pad2(h) + ':00';
  return ((h % 12) || 12) + (short ? (h < 12 ? 'a' : 'p') : '\u202f' + (h < 12 ? 'AM' : 'PM'));
}
// Day and month, no year: 17 Nov or Nov 17 (long: November).
function fmtDM(day, mon, long) {
  var mn = (long ? MONTHS_LONG : MONTHS)[mon];
  return dateOrder() === 'dmy' ? day + ' ' + mn : mn + ' ' + day;
}
// A full date: 17 Nov 2026, Nov 17, 2026 or 2026-11-17 (long spells the month out).
function fmtDMY(y, mon, day, long) {
  var o = dateOrder();
  if (o === 'ymd') return y + '-' + pad2(mon + 1) + '-' + pad2(day);
  return o === 'mdy' ? fmtDM(day, mon, long) + ', ' + y : fmtDM(day, mon, long) + ' ' + y;
}
// Two days as a range, saying the month and year once where they're shared.
function fmtRange(a, z) {
  var A = dayToDate(a), Z = dayToDate(z), o = dateOrder();
  var ay = A.getUTCFullYear(), am = A.getUTCMonth(), ad = A.getUTCDate(), zy = Z.getUTCFullYear(), zm = Z.getUTCMonth(), zd = Z.getUTCDate();
  var sameY = ay === zy, sameM = sameY && am === zm;
  if (o === 'ymd') return fmtDMY(ay, am, ad) + ' – ' + (sameY ? pad2(zm + 1) + '-' + pad2(zd) : fmtDMY(zy, zm, zd));
  if (o === 'mdy') return fmtDM(ad, am) + (sameY ? '' : ', ' + ay) + ' – ' + (sameM ? zd : fmtDM(zd, zm)) + ', ' + zy;
  return ad + (sameM ? '' : ' ' + MONTHS[am]) + (sameY ? '' : ' ' + ay) + ' – ' + fmtDMY(zy, zm, zd);
}
function niceDate(d) { var x = dayToDate(d); return fmtDMY(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()); }
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
    return fmtRange(periodStart(d, u), periodEnd(d, u));
  }
  return niceDate(d);
}
function longDate(d) { var x = dayToDate(d); return DOW_LONG[x.getUTCDay()] + ', ' + fmtDMY(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate(), true); }
function pad2(n) { return (n < 10 ? '0' : '') + n; }
// Clock time where the trip happened when the file says the UTC offset, else in this browser's time zone.
function clock(ms, off, withDate) {
  var known = off != null && off !== NO_OFF, d = new Date(known ? ms + off * 60000 : ms);
  var g = function (k) { return d[(known ? 'getUTC' : 'get') + k](); };
  var t = fmtHM(g('Hours'), g('Minutes'));
  if (withDate) t = fmtDMY(g('FullYear'), g('Month'), g('Date')) + ', ' + t;
  return t;
}
// Just the date of that moment, in the same time zone as clock().
function clockDate(ms, off) {
  var known = off != null && off !== NO_OFF, d = new Date(known ? ms + off * 60000 : ms);
  return known ? fmtDMY(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) : fmtDMY(d.getFullYear(), d.getMonth(), d.getDate());
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
// Long work written as a generator (function*) that yields now and then. runAll does it in one go;
// runSoon does it SLICE_MS at a time, letting the page paint in between, so the loader's icons keep
// changing while the trips are worked out (in a hidden tab, where nothing paints, it goes straight on).
function runAll(g) { while (!g.next().done); }
var SLICE_MS = 40;
function runSoon(g) {
  return new Promise(function (resolve, reject) {
    function step() {
      var t0 = performance.now();
      try {
        for (;;) {
          if (g.next().done) { resolve(); return; }
          if (!document.hidden && performance.now() - t0 > SLICE_MS) break;
        }
      } catch (e) { reject(e); return; }
      setTimeout(step, 0);
    }
    step();
  });
}
// A slow change (a switch that makes every trip be worked out again): the "Working on it" pill and a
// veil over the page show at once, a frame paints, then the work runs and both go when it's done.
// The pill fades in only after 150 ms, so quick changes don't flash it; its spinner and fade are
// transform and opacity animations, which keep running while the work holds the page.
var WORKING = { n: 0 };
function working(text, fn) {
  var el = $('working');
  WORKING.n++;
  $('workingText').textContent = text || 'Working on it…';
  el.hidden = false;
  var done = false;
  function go() {
    if (done) return;
    done = true;
    try { fn(); } finally {
      // Taps made while the work ran land on the veil, not on what is under it.
      setTimeout(function () { if (!--WORKING.n) el.hidden = true; }, 0);
    }
  }
  requestAnimationFrame(function () { setTimeout(go, 0); });
  // A page in the background doesn't paint, so the work doesn't wait for a frame there.
  setTimeout(go, 200);
}
// Anything that saves: the same pill, so a tap that saves never looks like nothing happened
// while the trips are worked out again (David's rule: a spinner on every action that saves).
function saving(fn, text) { working(text || 'Saving…', fn); }
// The loading screen: a donut that fills with the reading progress (when the text ends in
// "· 42%"; otherwise, or once it reaches 100%, an arc spins) around an icon that keeps changing between transport, a pin
// and world landmarks, each in its own colour, which the ring takes on too.
var LOADER_ICONS = [
  ['FLYING', '--m-air'], ['castle', '--accent'], ['CAR', '--m-road'], ['temple_buddhist', '--m-foot'], ['pin', '--dot'],
  ['TRAIN', '--m-transit'], ['mosque', '--m-transit'], ['WALKING', '--m-foot'], ['church', '--m-bike'], ['pin', '--dot'],
  ['CYCLING', '--m-bike'], ['account_balance', '--m-road'], ['FERRY', '--m-water'], ['temple_hindu', '--m-air'], ['pin', '--dot'],
  ['BUS', '--m-road'], ['stadium', '--m-water'], ['TRAM', '--m-transit'], ['synagogue', '--m-road'], ['pin', '--dot'],
  ['FLYING', '--m-air'], ['attractions', '--m-water'], ['WALKING', '--m-foot'], ['fort', '--accent'], ['pin', '--dot']
];
var LOADER_R = 64, LOADER_C = 2 * Math.PI * LOADER_R;
function loaderIcon(first) {
  var el = $('busy'), donut = el.querySelector('.ld-donut'), item = LOADER_ICONS[busy.i % LOADER_ICONS.length];
  donut.style.setProperty('--c', 'var(' + item[1] + ')');
  var old = donut.querySelector('.ld-ico:not(.out)'), n = document.createElement('div');
  n.className = 'ld-ico' + (first ? '' : ' in'); n.innerHTML = icon(item[0]);
  donut.appendChild(n);
  if (old) { old.classList.add('out'); setTimeout(function () { old.remove(); }, 250); }
}
function busy(text) {
  var el = $('busy');
  if (!text) { el.hidden = true; clearInterval(busy.t); busy.t = null; return; }
  // At 100% the file is read but still being worked through, so the arc spins from there on.
  var m = /^(.*?)\s*·\s*(\d+)%$/.exec(text), pct = m && +m[2] < 100 ? +m[2] : null;
  var arc = el.querySelector('.ld-arc'), donut = el.querySelector('.ld-donut');
  el.querySelector('.ld-t').textContent = (m ? m[1] : text).replace(/…$/, '') + (m ? '' : '…');
  el.querySelector('.ld-p').textContent = pct === null ? '' : pct + '%';
  donut.classList.toggle('spin', pct === null);
  arc.style.strokeDashoffset = LOADER_C * (pct === null ? 0.72 : 1 - pct / 100);
  if (el.hidden) {
    el.hidden = false;
    busy.i = Math.floor(Math.random() * LOADER_ICONS.length);
    donut.querySelectorAll('.ld-ico').forEach(function (x) { x.remove(); });
    loaderIcon(true);
    clearInterval(busy.t);
    busy.t = setInterval(function () { busy.i++; loaderIcon(); }, 900);
  }
}

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
// The towns by 1° cell. Not CT, which is the Countries over time strip's state in insights.js.
var CITY_GRID = null;
function buildCities() {
  CITY_GRID = {};
  var la = 0, lo = 0;
  CITIES.split(';').forEach(function (e) {
    var f = e.split(','), n = f.length;
    la += parseInt(f[n - 2], 36); lo += parseInt(f[n - 1], 36);
    var c = { name: f.slice(0, n - 3).join(','), w: [1, 1.4, 2, 2.6][+f[n - 3]], lat: la / 100, lng: lo / 100 }, key = Math.floor(c.lat) + ',' + Math.floor(c.lng);
    (CITY_GRID[key] || (CITY_GRID[key] = [])).push(c);
  });
}
// The town or city a place belongs to (within 60 km), with its distance in km.
function nearestCity(lat, lng) {
  if (!CITY_GRID) buildCities();
  // Bigger places win when a small town is only a little closer, as people name them that way.
  var best = null, bs = Infinity, bd = 0, la = Math.floor(lat), lo = Math.floor(lng);
  for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
    var cell = CITY_GRID[(la + dy) + ',' + (((lo + dx + 180) % 360 + 360) % 360 - 180)];
    if (cell) for (var k = 0; k < cell.length; k++) {
      var d = km([lat, lng], [cell[k].lat, cell[k].lng]);
      if (d < 60 && d / cell[k].w < bs) { bs = d / cell[k].w; bd = d; best = cell[k]; }
    }
  }
  return best && { name: best.name, d: bd, lat: best.lat, lng: best.lng };
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
    return { time: fmtHM(+parts.hour, +parts.minute), date: fmtDMY(+parts.year, +parts.month - 1, +parts.day),
      label: zone.split('/').pop().replace(/_/g, ' ') + ' time, ' + utc };
  } catch (e) { /* unknown zone: fall through */ }
  return { time: clock(ms, off), date: clockDate(ms, off), label: tzLabel(off) };
}
