# Home Control

Local-only home dashboard, plain JavaScript with no dependencies:

- **Sky Q** boxes: what's on, TV guide with favourites, remote keys, apps.
- **Android TV, NVIDIA Shield and Fire TV** over ADB: status, remote keys, app launching, Wake-on-LAN.
- **Network-only smart TVs** (e.g. Vestel-built Sharp Aquos): volume, mute, YouTube / Netflix over DIAL.
- **Philips Hue** lights, **Hive** heating and hot water (Hive account), **Ring** doorbells and cameras (Ring account),
  **Yale Smart Alarm** (Yale Alarm app account): status, open doors, arm / part arm, disarm with a PIN.
- **Home-network IP cameras** with an RTSP stream: snapshots and a tap-to-watch live view (needs `ffmpeg` on the server).
- **Network health**: router/internet reachability, Cisco switch status, event log.
- **Routines** run by the server (lights, heating, TVs, arming the alarm): daily ("porch light on at 20:00") or one-off; from the TV Guide, "Set up for this
  show" dims the lights, boosts the heating and switches the Sky box just before a programme starts.
- **Any phone or tablet** on the home network: Add to Home Screen installs it like an app, and `/#/wall` is an
  always-on wall-tablet dashboard (clock, doorbell, alarm, heating, lights, TV, upcoming routines). The Hallway tab
  (`/#/hallway`) is a TV-free panel: alarm and its devices, heating, lights, cameras and weather
  ([Open-Meteo](https://open-meteo.com), free for non-commercial use; the place is picked on the screen).

Hive, Ring and Yale are reached through the same (unofficial) cloud APIs their own apps use; they can change without
notice. The Yale calls follow [yale-smart-alarm-client](https://github.com/domwillcode/yale-smart-alarm-client)
(Apache-2.0). This project is not affiliated with Sky, Hive, Ring, Yale, NVIDIA, Amazon, Philips, Sharp or Cisco.

- Node 20+, no npm dependencies (runs fine on an old 32-bit Debian box).
- Runs on `127.0.0.1:8790` behind nginx on **`http://<server-ip>`** (by IP, so other sites on the box are untouched), allowed from the home network only, plus a
  household password. Not exposed to the internet.
- Settings and secrets (Hue key, Cisco password, Hive / Ring / Yale sign-in tokens, alarm PIN hash, ADB key) live in
  `/var/lib/home-control/` (mode 600), entered on the Settings page — never in the repo. Hive, Ring and Yale passwords are
  used once at sign-in and not stored. Disarming the alarm needs a PIN; setting it needs the Yale password, and
  routines can arm the alarm but never disarm it.
- Cisco access is read-only: only `show` commands are allowed (`src/cisco.js`).

## Run locally
```
node src/server.js        # http://localhost:8790, data in ./data
```

## Deploy
Put the server's SSH login in `deploy/server.env` (ignored by git): `DEPLOY_SERVER=user@<server-ip>`
```
bash deploy/push.sh --first-install   # once (asks for your sudo password on the server)
bash deploy/push.sh                   # updates: app code only, no password
bash deploy/push.sh --status | --logs
```
Updates never change the systemd unit, nginx site or sudo helper; if those change, re-run `--first-install`.

## First use
1. Open `http://<server-ip>` and choose the household password.
2. Settings → Philips Hue: press the bridge's round button, then **Pair with bridge**.
3. Settings → Cisco: enter the switches' telnet password and enable secret (switch monitoring starts within a minute).

## Licence
MIT — see [LICENSE](LICENSE).
