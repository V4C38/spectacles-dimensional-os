"""Print calibration-board URL and ASCII QR code to the terminal."""

from __future__ import annotations


def print_marker_qr(url: str) -> None:
    print(f"\nCalibration board: {url}", flush=True)
    print("Scan with your phone during the Calibrate step.\n", flush=True)
    try:
        import qrcode

        qr = qrcode.QRCode(border=1)
        qr.add_data(url)
        qr.make(fit=True)
        qr.print_ascii(invert=True)
        print(flush=True)
    except ImportError:
        print("(Install qrcode for terminal QR: pip install qrcode)\n", flush=True)
