# Tree divergence

Case: vendor/html5lib-tests/tree-construction/tests1.dat#25

## Input
```html
<!DOCTYPE html><span><button>foo</span>bar
```

## Expected
```text
| <!DOCTYPE html>
| <html>
|   <head>
|   <body>
|     <span>
|       <button>
|         "foobar"

```

## Actual
```text
| <!DOCTYPE html>
| <span>
|   <button>
|     "foo"
| "bar"
```
