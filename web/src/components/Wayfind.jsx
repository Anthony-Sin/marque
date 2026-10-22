import React from 'react';
import { Link } from 'react-router-dom';

// Minimal top-left wayfinding — with no persistent nav chrome the Dashboard
// IS the hub, so every non-dashboard surface carries this quiet ghost link
// back to it. Sits above the page's own header; never a bar.
export default function Wayfind({ label = 'Dashboard' }) {
  return (
    <div className="wayfind-row">
      <Link className="wayfind" to="/dashboard">
        <span className="wayfind-arrow" aria-hidden="true">←</span>
        <span>{label}</span>
      </Link>
    </div>
  );
}
