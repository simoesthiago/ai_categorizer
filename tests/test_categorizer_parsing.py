from categorizer import normalize_confidence, parse_model_output


def test_parse_plain_lines_without_confidence():
    output = "Finance\nHR\nOperations"
    categories, confidences = parse_model_output(
        raw_output=output,
        expected_count=3,
        include_confidence=False,
    )
    assert categories == ["Finance", "HR", "Operations"]
    assert confidences == []


def test_parse_pipe_lines_with_confidence():
    output = "Finance | High\nHR | Medium\nOperations | Low"
    categories, confidences = parse_model_output(
        raw_output=output,
        expected_count=3,
        include_confidence=True,
    )
    assert categories == ["Finance", "HR", "Operations"]
    assert confidences == ["High", "Medium", "Low"]


def test_parse_json_output():
    output = '[{"category":"Finance","confidence":"High"},{"category":"HR","confidence":"Low"}]'
    categories, confidences = parse_model_output(
        raw_output=output,
        expected_count=2,
        include_confidence=True,
    )
    assert categories == ["Finance", "HR"]
    assert confidences == ["High", "Low"]


def test_normalize_confidence_variants():
    assert normalize_confidence("alta") == "High"
    assert normalize_confidence("media") == "Medium"
    assert normalize_confidence("baixa") == "Low"
    assert normalize_confidence("unexpected") == "Medium"
