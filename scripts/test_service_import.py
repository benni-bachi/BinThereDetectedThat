import unittest
from urllib.parse import parse_qs, urlsplit
from import_service_overview import container_size, days_for, form_url, PARAMS


class ServiceImportTests(unittest.TestCase):
    def test_ranges_and_missing_days(self):
        self.assertEqual(days_for('MON-FRI'), ['MON','TUE','WED','THU','FRI'])
        self.assertEqual(days_for('-'), [])
        with self.assertRaises(ValueError):
            days_for('TUE/FUNDAY')

    def test_mixed_sizes_need_confirmation(self):
        self.assertIsNone(container_size('64GAL / 6YD'))
        self.assertEqual(container_size('64GAL'), '64 Gallon Container')

    def test_forms_spaces_and_special_characters(self):
        row = dict(BinID='BIN-004',BuildingLocation='A & B / Lab',WasteStream='Landfill',ContainerTypeSize='4 Yard Dumpster')
        result = form_url('https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=test',row)
        self.assertNotIn('+', result)
        self.assertIn('4%20Yard%20Dumpster', result)
        self.assertEqual(parse_qs(urlsplit(result).query)[PARAMS[0]], ['A & B / Lab'])


if __name__ == '__main__':
    unittest.main()
