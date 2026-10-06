// Phase 9: the app's entry. The background "Delivered" task (a message push
// arriving while Chimp is in the background) must be defined in module scope
// before anything else, so iOS can run it without the UI.
import './src/services/deliveryAck';
import 'expo-router/entry';
