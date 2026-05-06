import {
  Client,
  TravelMode,
  TrafficModel,
  UnitSystem,
} from '@googlemaps/google-maps-services-js';
import { config } from '../config';

const mapsClient = new Client({});

export type TrafficStatus = 'light' | 'moderate' | 'heavy';

export interface DirectionsResult {
  duration_minutes: number;
  duration_in_traffic_minutes: number;
  distance_km: number;
  route_summary: string;
  traffic_status: TrafficStatus;
}

/** Get driving directions between two addresses */
export async function getDrivingDirections(
  origin: string,
  destination: string,
  departureTime: Date = new Date()
): Promise<DirectionsResult> {
  const response = await mapsClient.directions({
    params: {
      origin,
      destination,
      mode: TravelMode.driving,
      departure_time: departureTime,
      traffic_model: TrafficModel.best_guess,
      units: UnitSystem.metric,
      key: config.google.mapsApiKey,
    },
  });

  if (response.data.status !== 'OK' || response.data.routes.length === 0) {
    throw new Error(`Maps API error: ${response.data.status}`);
  }

  const leg = response.data.routes[0].legs[0];
  const durationSecs = leg.duration?.value ?? 0;
  const durationTrafficSecs = leg.duration_in_traffic?.value ?? durationSecs;
  const distanceMeters = leg.distance?.value ?? 0;

  const baseMins = Math.ceil(durationSecs / 60);
  const trafficMins = Math.ceil(durationTrafficSecs / 60);
  const ratio = trafficMins / Math.max(baseMins, 1);

  let trafficStatus: TrafficStatus = 'light';
  if (ratio > 1.5) trafficStatus = 'heavy';
  else if (ratio > 1.2) trafficStatus = 'moderate';

  // Build a human-readable summary from the first few steps
  const via = response.data.routes[0].summary;
  const summary = `Via ${via} — ${trafficMins} min${trafficMins !== baseMins ? ` (normally ${baseMins} min)` : ''}`;

  return {
    duration_minutes: baseMins,
    duration_in_traffic_minutes: trafficMins,
    distance_km: Math.round(distanceMeters / 100) / 10,
    route_summary: summary,
    traffic_status: trafficStatus,
  };
}

/** Calculate when someone must leave to arrive by a given time */
export function calculateDepartureTime(
  arrivalTarget: Date,
  travelMinutes: number,
  bufferMinutes = 10
): Date {
  const departure = new Date(arrivalTarget);
  departure.setMinutes(departure.getMinutes() - travelMinutes - bufferMinutes);
  return departure;
}
