# 矢書 アイコン（2a 落款）

## Next.js（App Router）
- favicon/favicon.ico → src/app/favicon.ico
- favicon/icon-256.png → src/app/icon.png
- ios/apple-touch-icon.png → src/app/apple-icon.png

## PWA（manifest）
android/ の 4 ファイルを public/icons/ に置き、manifest に:
```json
"icons": [
  { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
  { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
  { "src": "/icons/icon-192-maskable.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
  { "src": "/icons/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
]
```

## ネイティブアプリ（iOS）
ios/AppIcon-1024.png を Xcode の AppIcon に。角は OS が丸めるので四角のまま。
