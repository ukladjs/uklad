import { dispatch, regEffect, enableMapSet } from "@flexsurfer/reflex";
import { saveSettings } from "./utils/settingsStorage";
import { reflexReviver } from "./utils/serialization";

enableMapSet();

let wsConnection: WebSocket | null = null;

// Store WebSocket reference for sending messages
const connectWebSocket = () => {
    const wsHost = import.meta.env.VITE_WS_HOST || window.location.host;
    const wsUrl = `ws://${wsHost}/ui`;
    const wsRef = new WebSocket(wsUrl);

    // Store the reference
    wsConnection = wsRef;

    wsRef.onopen = () => {
        dispatch(['set-connected', true]);
        console.log('Connected to Reflex Devtools');
    };

    wsRef.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data, reflexReviver);

            if (data.type === 'reflex-traces') {
                dispatch(['add-traces', data.payload]);
            } else if (data.type === 'reflex-app-db') {
                dispatch(['update-db', data.payload]);
            } else if (data.type === 'reflex-active-subs') {
                dispatch(['update-active-subs', data.payload]);
            } else if (data.type === 'reflex-handler-keys') {
                dispatch(['update-handler-keys', data.payload]);
            }
        } catch (error) {
            console.error('Error parsing event:', error);
        }
    };

    wsRef.onclose = () => {
        wsConnection = null;
        dispatch(['set-connected', false]);
        console.log('Disconnected from Reflex Devtools');
        // Attempt to reconnect after 5 seconds
        setTimeout(connectWebSocket, 5000);
    };

    wsRef.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
};

regEffect('init-socket', () => {
    connectWebSocket();
});

regEffect('save-settings', (settings) => {
    saveSettings(settings);
});

regEffect('send-dispatch-to-client', (payload: { eventName: string, params: any }) => {
    
    if (!wsConnection) {
        console.error('[UI] WebSocket connection is null');
        return;
    }
    
    if (wsConnection.readyState !== WebSocket.OPEN) {
        console.error('[UI] WebSocket not open. State:', wsConnection.readyState);
        return;
    }

    const message = {
        type: 'dispatch-to-client',
        payload
    };

    try {
        const messageStr = JSON.stringify(message);
        wsConnection.send(messageStr);
    } catch (error) {
        console.error('[UI] Error sending message:', error);
    }
});