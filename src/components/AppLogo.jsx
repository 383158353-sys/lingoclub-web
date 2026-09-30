import React from "react";

// Lingo Club app icon — directly uses the provided icon asset.
const ICON_URL =
  "https://media.base44.com/images/public/6a7852460e8c60501e6ee862/63daf1202_image_3_850x850.png";

export default function AppLogo({ size = 32, className = "" }) {
  return (
    <img
      src={ICON_URL}
      width={size}
      height={size}
      alt="Lingo Club"
      className={className}
      style={{ display: "block", borderRadius: "22%" }}
    />
  );
}