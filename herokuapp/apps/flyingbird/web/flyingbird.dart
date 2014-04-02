import 'dart:html';

final Element container = querySelector("#sample_container_id");
final Element bird = querySelector("#bird");


void main() {
  window.onKeyDown.listen(handleInput);
}

void handleInput(e) {
  print(e.keyCode);
  //moveUp
  if (e.keyCode == 38){
    bird.attributes['margin-top'] = bird.attributes['margin-top'] + 5;
  }
  //moveDown
  //moveLeft
  //moveRight
}
