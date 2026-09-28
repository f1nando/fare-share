import { useId } from 'react';
import { fleetRoadStrip } from './fleetWall.js';

export function RoadMarkStrip({ settings, className = '', sizeUnit = '%' }) {
  const patternId = `road-pattern-${useId().replaceAll(':', '')}`;
  const strip = fleetRoadStrip(settings);
  const angleOffset = Number.isFinite(settings.markAngleOffset) ? settings.markAngleOffset : 0;
  const opacity = Number.isFinite(settings.markOpacity) ? settings.markOpacity / 100 : 1;

  return (
    <svg className={className} viewBox={`0 0 ${strip.width} ${strip.height}`} preserveAspectRatio="none" style={{
      left: `${settings.markX}%`,
      top: `${settings.markY}%`,
      width: `${strip.width}${sizeUnit}`,
      height: `${strip.height}${sizeUnit}`,
      opacity,
      transform: `translate(-50%, -50%) rotate(${settings.pathAngle}deg)`,
    }} aria-hidden="true">
      <defs>
        <pattern id={patternId} width={settings.markSpacing} height={strip.height} patternUnits="userSpaceOnUse">
          <image href="/driving-demo/mark.webp" width={settings.markWidth} height={strip.height}
            preserveAspectRatio="none" transform={`rotate(${angleOffset} ${settings.markWidth / 2} ${strip.height / 2})`} />
        </pattern>
      </defs>
      <rect width={strip.width} height={strip.height} fill={`url(#${patternId})`} />
    </svg>
  );
}
