// Format event timestamp
export const formatTimestamp = (timestamp: number): string => {
  return new Date(timestamp).toLocaleTimeString();
};

// Format payload for display
export const formatPayload = (payload: any): string => {
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}; 