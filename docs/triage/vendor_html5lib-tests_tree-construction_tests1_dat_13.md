# Tree divergence

Case: vendor/html5lib-tests/tree-construction/tests1.dat#13

## Input
```html
<html><head><body></html>
```

## Expected
```text
| <html>
|   <head>
|   <body>

```

## Actual
```text
| <html>
|   <head>
|     <body>
```
