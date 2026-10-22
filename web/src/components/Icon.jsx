import React from 'react';

// Minimal inline-SVG icon set (stroke-based, 24px grid).
const P = {
  dna: 'M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9M8 6.5h8M8 17.5h8M9.5 9.5h5M9.5 14.5h5',
  campaign: 'M4 10v4a1 1 0 0 0 1 1h2l4 4V5L7 9H5a1 1 0 0 0-1 1Zm11-4.5c1.6.9 2.5 2.6 2.5 4.5s-.9 3.6-2.5 4.5M13 8l7-3M13 16l7 3',
  photo: 'M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4M8.5 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  book: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Zm0 13a3 3 0 0 1 3-3h11M9 8h6',
  site: 'M4 5h16v14H4zM4 9h16M7 7h.01M9 7h.01M8 12h8M8 15h5',
  megaphone: 'M3 10v4h3l5 5V5L6 10H3Zm14-4 4-2M17 10h5M17 15l4 2',
  sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3ZM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z',
  bag: 'M6 8h12l-1 12H7L6 8Zm3 0a3 3 0 0 1 6 0',
  image: 'M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4M8.5 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  aspect: 'M4 7h13v10H4zM17 10h3v7h-3z',
  mic: 'M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3ZM6 11a6 6 0 0 0 12 0M12 17v4',
  edit: 'M4 20h4l11-11-4-4L4 16v4Zm9.5-14.5 4 4',
  kebab: 'M12 5h.01M12 12h.01M12 19h.01',
  link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4',
  download: 'M12 4v11m0 0 4-4m-4 4-4-4M5 20h14',
  play: 'M7 5l12 7-12 7V5Z',
  send: 'M4 12l16-7-7 16-2.5-6.5L4 12Z',
  plus: 'M12 5v14M5 12h14',
  trash: 'M5 7h14M9 7V4h6v3m-8 0 1 13h8l1-13',
  check: 'M5 13l4 4 10-11',
  x: 'M6 6l12 12M18 6 6 18',
  palette: 'M12 3a9 9 0 1 0 0 18h1a3 3 0 0 0 0-6h-1a2 2 0 0 1 0-4h7a3 3 0 0 0 1-2.2C20.4 5.4 16.6 3 12 3ZM7.5 10a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4Zm4-3a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4Z',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-9 9h18M12 3c2.7 2.4 4 5.6 4 9s-1.3 6.6-4 9c-2.7-2.4-4-5.6-4-9s1.3-6.6 4-9Z',
  qloo: 'M12 3a7 7 0 0 1 7 7c0 3-2 4.5-3.4 6.1-1.1 1.3-2.3 2.6-2.6 4.9h-2c-.3-2.3-1.5-3.6-2.6-4.9C7 14.5 5 13 5 10a7 7 0 0 1 7-7Zm-3 18h6M10 22.5h4',
  upload: 'M12 16V5m0 0-4 4m4-4 4 4M5 20h14',
  film: 'M4 5h16v14H4zM4 9h16M8 5v14M16 5v14M10 12l4 2-4 2v-4Z',
  share: 'M8 12a3 3 0 1 0 0-.01M16 7a3 3 0 1 0 0-.01M16 17a3 3 0 1 0 0-.01M10.6 10.8l2.8-1.6M10.6 13.2l2.8 1.6',
  eye: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Zm10 2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  layout: 'M4 4h16v16H4zM4 10h16M10 10v10',
};

export default function Icon({ name, size = 24, sw = 1.7 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none"
      stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      <path d={P[name] || P.sparkle} />
    </svg>
  );
}

export function Logo({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <circle cx="24" cy="24" r="22" fill="#d3e374" />
      <circle cx="24" cy="24" r="15" fill="none" stroke="#1c2208" strokeWidth="2.4" strokeDasharray="4 4" />
      <text x="24" y="31" textAnchor="middle" fontSize="19" fontWeight="700" fill="#1c2208" fontFamily="Georgia, serif" fontStyle="italic">M</text>
    </svg>
  );
}
