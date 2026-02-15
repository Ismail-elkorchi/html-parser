# Tree divergence

Case: vendor/html5lib-tests/tree-construction/tests1.dat#26

## Input
```html
<p><b><div><marquee></p></b></div>X
```

## Expected
```text
| <html>
|   <head>
|   <body>
|     <p>
|       <b>
|     <div>
|       <b>
|         <marquee>
|           <p>
|           "X"

```

## Actual
```text
| <p>
|   <b>
|     <div>
|       <marquee>
| "X"
```
