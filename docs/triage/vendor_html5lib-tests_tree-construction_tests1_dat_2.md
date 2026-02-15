# Tree divergence

Case: vendor/html5lib-tests/tree-construction/tests1.dat#2

## Input
```html
<p>One<p>Two
```

## Expected
```text
| <html>
|   <head>
|   <body>
|     <p>
|       "One"
|     <p>
|       "Two"

```

## Actual
```text
| <p>
|   "One"
|   <p>
|     "Two"
```
