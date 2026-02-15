# Tree divergence

Case: vendor/html5lib-tests/tree-construction/tests1.dat#23

## Input
```html
<a><p>X<a>Y</a>Z</p></a>
```

## Expected
```text
| <html>
|   <head>
|   <body>
|     <a>
|     <p>
|       <a>
|         "X"
|       <a>
|         "Y"
|       "Z"

```

## Actual
```text
| <a>
|   <p>
|     "X"
|     <a>
|       "Y"
|     "Z"
```
