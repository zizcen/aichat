package com.grok2api.creativeworkbench;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    public MainActivity() {
        registerPlugin(SecureStorePlugin.class);
        registerPlugin(NativeHttpPlugin.class);
        registerPlugin(MediaStorePlugin.class);
    }
}
