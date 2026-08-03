export interface Settings {
  showRenders: boolean;
  showBadges: boolean;
  showParams: boolean;
  showTimestamps: boolean;
}

const SETTINGS_KEY = 'uklad-devtools-settings';

const DEFAULT_SETTINGS: Settings = {
  showRenders: false,
  showBadges: false,
  showParams: true,
  showTimestamps: false,
};

export function loadSettings(): Settings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Merge with defaults to ensure all properties exist
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch (error) {
    console.warn('Failed to load settings from localStorage:', error);
  }
  return DEFAULT_SETTINGS;
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn('Failed to save settings to localStorage:', error);
  }
}
