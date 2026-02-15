# Tree divergence

Case: vendor/html5lib-tests/tree-construction/tests1.dat#28

## Input
```html
<!--><div>--<!-->
```

## Expected
```text
| <!--  -->
| <html>
|   <head>
|   <body>
|     <div>
|       "--"
|       <!--  -->

```

## Actual
```text
| <!-- ><div>--<! -->
```
