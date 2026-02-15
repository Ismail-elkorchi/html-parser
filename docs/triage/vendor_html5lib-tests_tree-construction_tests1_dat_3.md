# Tree divergence

Case: vendor/html5lib-tests/tree-construction/tests1.dat#3

## Input
```html
Line1<br>Line2<br>Line3<br>Line4
```

## Expected
```text
| <html>
|   <head>
|   <body>
|     "Line1"
|     <br>
|     "Line2"
|     <br>
|     "Line3"
|     <br>
|     "Line4"

```

## Actual
```text
| "Line1"
| <br>
|   "Line2"
|   <br>
|     "Line3"
|     <br>
|       "Line4"
```
