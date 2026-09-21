// Track 2 remains the taxi shoulder; 3 is a separate normal outer lane.
export const THIRD_TRACK = 3;
export const BOULEVARD_HALF = 5.48;
export const boulevardRoad = (axis,line) => ((line-axis*3)%6+6)%6===0;
export const streetHalf = (axis,line) => boulevardRoad(axis,line)?BOULEVARD_HALF:3.85;
export const streetTracks = (axis,line) => boulevardRoad(axis,line)?[0,1,THIRD_TRACK]:[0,1];
export const junctionStop = (x,z) => Math.max(streetHalf(0,z),streetHalf(1,x))+1.5;
