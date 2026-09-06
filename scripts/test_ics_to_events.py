import importlib.util
import pathlib
import unittest


SCRIPT = pathlib.Path(__file__).with_name("ics_to_events.py")
SPEC = importlib.util.spec_from_file_location("ics_to_events", SCRIPT)
ICS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ICS)


def feed(*lines):
    return "\r\n".join(("BEGIN:VCALENDAR", *lines, "END:VCALENDAR"))


class DateRangeTests(unittest.TestCase):
    def test_all_day_multiday_uses_inclusive_end_date(self):
        events = ICS.parse_events(feed(
            "BEGIN:VEVENT",
            "DTSTART;VALUE=DATE:20261004",
            "DTEND;VALUE=DATE:20261007",
            "SUMMARY:Festival",
            "END:VEVENT",
        ))
        self.assertEqual(events[0]["date"], "2026-10-04")
        self.assertEqual(events[0]["endDate"], "2026-10-06")
        self.assertNotIn("time", events[0])

    def test_single_day_timed_event_keeps_start_time(self):
        events = ICS.parse_events(feed(
            "BEGIN:VEVENT",
            "DTSTART;TZID=America/New_York:20261004T170000",
            "DTEND;TZID=America/New_York:20261004T190000",
            "SUMMARY:Concert",
            "END:VEVENT",
        ))
        self.assertEqual(events[0]["time"], "5:00 pm")
        self.assertNotIn("endDate", events[0])

    def test_timed_multiday_event_suppresses_time(self):
        events = ICS.parse_events(feed(
            "BEGIN:VEVENT",
            "DTSTART;TZID=America/New_York:20261004T170000",
            "DTEND;TZID=America/New_York:20261006T190000",
            "SUMMARY:Residency",
            "END:VEVENT",
        ))
        self.assertEqual(events[0]["endDate"], "2026-10-06")
        self.assertNotIn("time", events[0])

    def test_single_day_all_day_event_has_no_range(self):
        events = ICS.parse_events(feed(
            "BEGIN:VEVENT",
            "DTSTART;VALUE=DATE:20261004",
            "DTEND;VALUE=DATE:20261005",
            "SUMMARY:Workshop",
            "END:VEVENT",
        ))
        self.assertNotIn("endDate", events[0])
        self.assertNotIn("time", events[0])


if __name__ == "__main__":
    unittest.main()
