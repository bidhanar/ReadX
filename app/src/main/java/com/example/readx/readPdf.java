package com.example.readx;

import androidx.annotation.RequiresApi;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;

import com.example.readx.ui.Notes;
import com.github.barteksc.pdfviewer.PDFView;
import com.github.barteksc.pdfviewer.listener.OnDrawListener;
import com.github.barteksc.pdfviewer.listener.OnLongPressListener;
import com.github.barteksc.pdfviewer.listener.OnRenderListener;
import com.github.barteksc.pdfviewer.util.FitPolicy;
import com.parse.Parse;
import com.parse.ParseObject;
import com.parse.ParseUser;

import android.content.DialogInterface;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.pdf.PdfRenderer;
import android.os.Build;
import android.os.Bundle;
import android.os.StrictMode;
import android.text.Layout;
import android.util.Range;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Toast;

import java.lang.reflect.Array;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.ArrayList;

public class readPdf extends AppCompatActivity {

    int pageNumber;
    PDFView pdfView;
    LinearLayout linearLayout;
    LinearLayout lays;
    Button save;
    Button show;
    Button create;
    Button cancel;
    ArrayList<Notes> arrayList = new ArrayList<>();
    ArrayList<String> arrayList1 = new ArrayList<>();
    EditText editText;
    String username = "user";
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_read_pdf);

        Parse.initialize(new Parse.Configuration.Builder(this)
                .applicationId(getString(R.string.back4app_app_id))
                .clientKey(getString(R.string.back4app_client_key))
                .server(getString(R.string.back4app_server_url))
                .build()
        );
        pdfView = findViewById(R.id.pdfView);
        linearLayout = findViewById(R.id.linearlayout);
        lays = findViewById(R.id.lays);
        save = findViewById(R.id.save);
        editText = findViewById(R.id.editText);
        show = findViewById(R.id.show);
        create = findViewById(R.id.create);
        cancel = findViewById(R.id.cancel);
        String username = getIntent().getStringExtra("name");
        loadBook(0);


        //Creating the Listener for show button
        show.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                lays.setVisibility(View.INVISIBLE);
                Intent intent = new Intent(getApplicationContext(),Messages.class);
                startActivity(intent);
            }
        });
        //Creating the Listener for create button
        create.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {

                AlertDialog.Builder builder
                        = new AlertDialog
                        .Builder(readPdf.this)
                        .setTitle("Note")
                        .setMessage("Do you want to create a note?")
                        .setCancelable(false)
                        .setPositiveButton("Yes", new DialogInterface.OnClickListener() {
                            @Override
                            public void onClick(DialogInterface dialog, int which) {
                                lays.setVisibility(View.INVISIBLE);
                                linearLayout.setVisibility(View.VISIBLE);
                            }
                        })
                        .setNegativeButton("No", new DialogInterface.OnClickListener() {
                            @Override
                            public void onClick(DialogInterface dialog, int which) {
                                Toast.makeText(getApplicationContext(),"Failed!!",Toast.LENGTH_SHORT).show();
                                dialog.cancel();
                            }
                        });

                AlertDialog alertDialog = builder.create();

                alertDialog.show();

            }
        });
        //Creating the Listener for save button
        save.setOnClickListener(new View.OnClickListener() {
            @RequiresApi(api = Build.VERSION_CODES.O)
            @Override
            public void onClick(View v) {
                linearLayout.setVisibility(View.INVISIBLE);
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
//                    Notes notes = new Notes(username,editText.getText().toString(), LocalTime.now(),pdfView.getCurrentPage());
                    addMessage(username,editText.getText().toString(), LocalDateTime.now().toString(),pdfView.getCurrentPage());
                    editText.setText("");
                    Toast.makeText(getApplicationContext(),"Saved Successfully!!",Toast.LENGTH_SHORT).show();
//
//                    int lastIndex = arrayList.size() -1;
//                    arrayList1.add(arrayList.get(lastIndex).getUsername() + " : " + arrayList.get(lastIndex).getMessage() + " at " + arrayList.get(lastIndex).getTime().toString() + " on Page " + String.valueOf(arrayList.get(lastIndex).getPage()));

                }
                hideKeybaord(v);
            }
        });
        //Creating the Listener for cancel button
        cancel.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                lays.setVisibility(View.INVISIBLE);
            }
        });

    }

    public void loadBook(int pageNumber){
        pdfView.fromAsset("sample.pdf")
                .enableSwipe(true) // allows to block changing pages using swipe
                .swipeHorizontal(false)
                .autoSpacing(true)
                .enableDoubletap(true)
                .defaultPage(0)
                .enableAnnotationRendering(true) // render annotations (such as comments, colors or forms)
                .password(null)
                .scrollHandle(null)
                .enableAntialiasing(true) // improve rendering a little bit on low-res screens
                // spacing between pages in dp. To define spacing color, set view background
                .spacing(0)
                .pageFitPolicy(FitPolicy.WIDTH)
                .onLongPress(new OnLongPressListener() {
                    @Override
                    public void onLongPress(MotionEvent e) {
                        lays.setVisibility(View.VISIBLE);
                    }
                })
                .onRender(new OnRenderListener() {
                    @Override
                    public void onInitiallyRendered(int nbPages) {
                        pdfView.fitToWidth(pdfView.getCurrentPage());
                        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);

                    }
                })
                .load();



    }

    private void hideKeybaord(View v) {
        InputMethodManager inputMethodManager = (InputMethodManager)getSystemService(INPUT_METHOD_SERVICE);
        inputMethodManager.hideSoftInputFromWindow(v.getApplicationWindowToken(),0);
    }
    public void addMessage(String username, String message, String time, int page){
        ParseObject Messages = new ParseObject("Messages");
        Messages.put("username", username);
        Messages.put("message", message);
        Messages.put("time", time);
        Messages.put("page", page);
        Messages.saveInBackground();
    }

}