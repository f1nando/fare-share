// Track 2 remains the taxi shoulder; 3 is a separate normal outer lane.
export const THIRD_TRACK = 3;
export const NORMAL_TRACKS = Object.freeze([0.82, 2.45, undefined, 4.08]);
export const BOULEVARD_LANE_SCALE = 1.3;
export const BOULEVARD_HALF = (NORMAL_TRACKS[3] + (NORMAL_TRACKS[1] - NORMAL_TRACKS[0]) / 2) * BOULEVARD_LANE_SCALE + .55;
export const boulevardRoad = (axis,line) => ((line-axis*3)%6+6)%6===0;
// Shared centres for scenery, spawning, lane changes and all route endpoints.
export const laneOffset = (axis,line,track) => {
  const scale = boulevardRoad(axis,line) ? BOULEVARD_LANE_SCALE : 1;
  if (track === -1) return -NORMAL_TRACKS[0] * scale;
  if (track === 2) return streetHalf(axis,line) + .21;
  return NORMAL_TRACKS[track] * scale;
};
export const laneDividers = (axis,line) => {
  const tracks = streetTracks(axis,line);
  return tracks.slice(1).map((track,i) => (laneOffset(axis,line,tracks[i]) + laneOffset(axis,line,track)) / 2);
};
export const streetHalf = (axis,line) => boulevardRoad(axis,line)?BOULEVARD_HALF:3.85;
export const streetTracks = (axis,line) => boulevardRoad(axis,line)?[0,1,THIRD_TRACK]:[0,1];
export const junctionStop = (x,z) => Math.max(streetHalf(0,z),streetHalf(1,x))+1.5;
