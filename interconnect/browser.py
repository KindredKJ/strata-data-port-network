#!/usr/bin/env python3
"""Native GTK/WebKit INTERCONNECT proof. No founder identity or credential embedding."""
import argparse
import json
import hashlib
import os
import sys
from pathlib import Path
from policy import navigation_allowed
from evidence import read_receipt, inspect_receipt

def main():
    parser = argparse.ArgumentParser(description="INTERCONNECT native browser proof")
    parser.add_argument("--network", action="store_true", help="Explicitly enable public HTTPS browsing for this session")
    parser.add_argument("--smoke-output", help="Write executed native-render evidence and exit")
    args = parser.parse_args()
    if os.environ.get("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS"):
        raise SystemExit("INTERCONNECT refuses disabled WebKit sandbox")
    import gi
    gi.require_version("Gtk", "3.0")
    gi.require_version("WebKit2", "4.1")
    from gi.repository import Gtk, WebKit2, GLib
    ready, _ = Gtk.init_check([])
    if not ready:
        raise SystemExit("INTERCONNECT requires a working graphical display")
    manager = WebKit2.WebsiteDataManager.new_ephemeral()
    manager.set_persistent_credential_storage_enabled(False)
    if not args.network:
        manager.set_network_proxy_settings(WebKit2.NetworkProxyMode.CUSTOM,
            WebKit2.NetworkProxySettings.new("http://127.0.0.1:9", []))
    context = WebKit2.WebContext.new_with_website_data_manager(manager)
    context.set_sandbox_enabled(True)
    if not context.get_sandbox_enabled():
        raise SystemExit("INTERCONNECT requires WebKit subprocess sandboxing")
    settings = WebKit2.Settings()
    settings.set_enable_developer_extras(False)
    settings.set_enable_webrtc(False)
    settings.set_enable_media_stream(False)
    settings.set_allow_file_access_from_file_urls(False)
    settings.set_allow_universal_access_from_file_urls(False)
    settings.set_enable_javascript(False)
    settings.set_enable_write_console_messages_to_stdout(False)
    window = Gtk.Window(title="INTERCONNECT · Kindred Labs")
    window.set_default_size(1100, 760)
    window.connect("destroy", Gtk.main_quit)
    layout = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)
    bar = Gtk.Box(spacing=6)
    address = Gtk.Entry()
    address.set_placeholder_text("Public HTTPS address" if args.network else "Local evidence mode · network disabled")
    address.set_sensitive(args.network)
    address.get_accessible().set_name("Website address")
    back, forward, reload = [Gtk.Button(label=name) for name in ("Back", "Forward", "Reload")]
    inspect = Gtk.Button(label="Inspect SDPN receipt")
    for button in (back, forward, reload): bar.pack_start(button, False, False, 0)
    bar.pack_start(address, True, True, 0)
    bar.pack_start(inspect, False, False, 0)
    status = Gtk.Label(label="Ephemeral profile · sandbox required · camera/microphone/agents/sync disabled")
    status.set_xalign(0)
    web = WebKit2.WebView(web_context=context, settings=settings)
    web.connect("permission-request", lambda _, request: (request.deny(), True)[1])
    context.connect("download-started", lambda _, download: download.cancel())
    web.connect("create", lambda *_: None)
    def decide(_, decision, kind):
        if kind in (WebKit2.PolicyDecisionType.NAVIGATION_ACTION, WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION):
            uri = decision.get_navigation_action().get_request().get_uri()
            if not navigation_allowed(uri, args.network):
                decision.ignore()
                status.set_text("Blocked by local navigation policy")
                return True
        return False
    web.connect("decide-policy", decide)
    def navigate(_):
        uri = address.get_text().strip()
        if navigation_allowed(uri, args.network): web.load_uri(uri)
        else: status.set_text("Enter a public HTTPS address; restricted schemes and credentials are rejected")
    address.connect("activate", navigate)
    back.connect("clicked", lambda _: web.go_back())
    forward.connect("clicked", lambda _: web.go_forward())
    reload.connect("clicked", lambda _: web.reload())
    web.connect("notify::uri", lambda *_: address.set_text(web.get_uri() or ""))
    def inspect_local(_):
        chooser = Gtk.FileChooserDialog(title="Choose a local SW06-F receipt", parent=window,
            action=Gtk.FileChooserAction.OPEN)
        chooser.add_buttons("Cancel", Gtk.ResponseType.CANCEL, "Inspect", Gtk.ResponseType.OK)
        try:
            if chooser.run() != Gtk.ResponseType.OK: return
            receipt = read_receipt(chooser.get_filename())
            result = inspect_receipt(receipt)
            # Native text widget only: receipt content never becomes executable page markup.
            dialog = Gtk.MessageDialog(transient_for=window, modal=True,
                message_type=Gtk.MessageType.INFO, buttons=Gtk.ButtonsType.CLOSE,
                text="Local receipt metadata inspected")
            dialog.format_secondary_text(json.dumps(result, indent=2))
            dialog.run()
            dialog.destroy()
        except (OSError, ValueError, TypeError, KeyError) as error:
            status.set_text("Receipt rejected: " + str(error))
        finally: chooser.destroy()
    inspect.connect("clicked", inspect_local)
    layout.pack_start(bar, False, False, 0)
    layout.pack_start(status, False, False, 0)
    layout.pack_start(web, True, True, 0)
    window.add(layout)
    window.show_all()
    result_code = [0]
    if args.smoke_output:
        def failed_timeout():
            result_code[0] = 1
            Gtk.main_quit()
            return False
        timeout_id = GLib.timeout_add_seconds(30, failed_timeout)
        def finished(_, event):
            if event != WebKit2.LoadEvent.FINISHED:
                return
            def checked(view, result, _data):
                try:
                    surface = view.get_snapshot_finish(result)
                    width, height = surface.get_width(), surface.get_height()
                    pixels = bytes(surface.get_data())
                    if width < 200 or height < 100 or len(set(pixels)) < 8:
                        raise ValueError("Native pixel rendering is empty")
                    evidence = {
                        "schema": "kindred.interconnect.native-render.v1",
                        "founder": "Kindred Jermaine Cox", "organization": "Kindred Labs",
                        "engine": "WebKitGTK", "native_page_load_finished": True,
                        "snapshot_width": width, "snapshot_height": height,
                        "pixel_sha256": hashlib.sha256(pixels).hexdigest(),
                        "engine_version": ".".join(str(x()) for x in (WebKit2.get_major_version, WebKit2.get_minor_version, WebKit2.get_micro_version)),
                        "subprocess_sandbox_enabled": context.get_sandbox_enabled(),
                        "ephemeral_profile": manager.is_ephemeral(),
                        "network_enabled": args.network, "javascript_enabled": settings.get_enable_javascript(),
                        "renderer_mode": "X11_FALLBACK_TEST_ONLY" if os.environ.get("WEBKIT_DISABLE_DMABUF_RENDERER") == "1" else "DEFAULT",
                        "software_gl_requested": os.environ.get("LIBGL_ALWAYS_SOFTWARE") == "1",
                        "production_authorized": False,
                    }
                    path = Path(args.smoke_output)
                    path.parent.mkdir(parents=True, exist_ok=True)
                    surface.write_to_png(str(path.with_suffix(".png")))
                    path.write_text(json.dumps(evidence, indent=2) + "\n")
                except Exception as error:
                    result_code[0] = 1
                    print("NATIVE_RENDER_FAILED " + str(error), file=sys.stderr)
                GLib.source_remove(timeout_id)
                Gtk.main_quit()
            gi.require_foreign("cairo")
            # The native snapshot API works while page JavaScript remains disabled.
            GLib.timeout_add(300, lambda: (web.get_snapshot(WebKit2.SnapshotRegion.VISIBLE,
                WebKit2.SnapshotOptions.NONE, None, checked, None), False)[1])
        web.connect("load-changed", finished)
    web.load_html("""<!doctype html><html lang="en"><head><meta charset="utf-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
      <style>body{background:#09151f;color:#e7f7ff;font:20px sans-serif;padding:5vw}h1{font-size:48px}p{max-width:760px;line-height:1.6}</style>
      </head><body><h1>INTERCONNECT</h1><p>Native independent browsing and local Strata evidence inspection.</p>
      <p>Founded by Kindred Jermaine Cox · Kindred Labs.</p>
      <p>Local proof build. Choose a receipt above. Public HTTPS browsing requires explicit session opt-in.
      Device sync, agents, private ports, and remote indexing require their own authorization gates.</p></body></html>""", "interconnect://home")
    Gtk.main()
    return result_code[0]

if __name__ == "__main__": raise SystemExit(main())
